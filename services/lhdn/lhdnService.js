const path = require('path')
const axios = require('axios');
const CryptoJS = require('crypto-js');
const fs = require('fs');
const forge = require('node-forge');
const jsonminify = require('jsonminify');
const crypto = require('crypto');
require('dotenv').config();
const prisma = require('../../src/lib/prisma');
const { getTokenSession } = require('../token-prisma.service');

// ----------------------------------------------------------------------------
// Simple in-process rate limiter per endpoint key
// ----------------------------------------------------------------------------
const RATE_LIMITS = {
  submitDocuments: { rpm: 100, minIntervalMs: Math.ceil(60000 / 100) }, // 600ms
  getSubmission: { rpm: 300, minIntervalMs: Math.ceil(60000 / 300) },   // ~200ms
  getDocumentDetails: { rpm: 125, minIntervalMs: Math.ceil(60000 / 125) }, // 480ms
  searchTIN: { rpm: 60, minIntervalMs: Math.ceil(60000 / 60) },         // 1000ms
  login: { rpm: 12, minIntervalMs: Math.ceil(60000 / 12) }              // 5000ms
};
const lastCallAt = new Map();

async function waitForSlot(key) {
  const cfg = RATE_LIMITS[key];
  if (!cfg) return; // unknown key, no wait
  const now = Date.now();
  const last = lastCallAt.get(key) || 0;
  const elapsed = now - last;
  if (elapsed < cfg.minIntervalMs) {
    const wait = cfg.minIntervalMs - elapsed;
    await new Promise(r => setTimeout(r, wait));
  }
  lastCallAt.set(key, Date.now());
}

function parseRetryAfter(headerVal) {
  if (!headerVal) return null;
  // Retry-After may be seconds or HTTP-date
  const seconds = Number(headerVal);
  if (!isNaN(seconds)) return seconds * 1000;
  const dt = Date.parse(headerVal);
  if (!isNaN(dt)) return Math.max(0, dt - Date.now());
  return null;
}

async function backoffWait(baseDelayMs, attempt) {
  const maxJitter = 250; // add small jitter
  const jitter = Math.floor(Math.random() * maxJitter);
  const delay = Math.min(60000, Math.floor((baseDelayMs || 1000) * Math.pow(2, attempt))) + jitter;
  await new Promise(r => setTimeout(r, delay));
}

async function getConfig() {
  const config = await prisma.wP_CONFIGURATION.findFirst({
    where: {
      Type: 'LHDN',
      IsActive: true
    },
    orderBy: {
      CreateTS: 'desc'
    }
  });

  if (!config) {
    throw new Error('LHDN configuration not found');
  }

  let settings = config.Settings;
  if (typeof settings === 'string') {
    try {
      settings = JSON.parse(settings);
    } catch (parseError) {
      console.error('Error parsing LHDN settings JSON:', parseError);
      throw new Error('Invalid LHDN configuration format');
    }
  }

  return settings;
}

async function getTokenAsIntermediary(attempt = 0) {
  try {
    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ? settings.middlewareUrl : settings.middlewareUrl;

    const httpOptions = {
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: 'client_credentials',
      scope: 'InvoicingAPI'
    };

    // Respect login limit
    await waitForSlot('login');

    const response = await axios.post(
      `${baseUrl}/connect/token`,
      httpOptions,
      {
        headers: {
          'onbehalfof': settings.tin,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if(response.status === 200) return response.data;
  } catch (err) {
    if (err.response?.status === 429) {
      const retryAfter = err.response.headers['retry-after'] || err.response.headers['x-rate-limit-reset'];
      const baseDelay = parseRetryAfter(retryAfter) || 5000; // login is 12 RPM
      console.warn(`[RateLimit] Login 429. Retrying after ~${baseDelay}ms`);
      await backoffWait(baseDelay, attempt);
      return await getTokenAsIntermediary(attempt + 1);
    }
    throw new Error(`Failed to get token: ${err.message}`);
  }
}

async function submitDocument(docs, token) {
  try {
    console.log('[LHDN Service] submitDocument called');

    if (!token) {
      console.error('[LHDN Service] Authentication token is missing in submitDocument call');
      return {
        status: 'failed',
        error: {
          code: 'AUTH_ERROR',
          message: 'Authentication token is required',
          details: 'No token was provided for LHDN API authentication. Please try logging out and logging in again.'
        }
      };
    }

    if (!docs || !Array.isArray(docs) || docs.length === 0) {
      console.error('[LHDN Service] Invalid or empty documents array provided to submitDocument');
      return {
        status: 'failed',
        error: {
          code: 'INVALID_DOCUMENT',
          message: 'No valid documents provided for submission',
          details: 'The document data is missing or invalid. Please check the document format.'
        }
      };
    }

    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ?
      settings.middlewareUrl : settings.middlewareUrl;

    console.log('[LHDN Service] LHDN API URL:', `${baseUrl}/api/v1.0/documentsubmissions`);
    console.log('[LHDN Service] Token present:', !!token);
    console.log('[LHDN Service] Token length:', token ? token.length : 0);
    console.log('[LHDN Service] Documents count:', docs.length);

    // Log token preview (first 10 chars only for security)
    if (token) {
      const tokenPreview = token.substring(0, 10) + '...';
      console.log('[LHDN Service] Token preview:', tokenPreview);
    }

    console.log('[LHDN Service] Making API request to LHDN...');

    // Respect submitDocuments limit
    await waitForSlot('submitDocuments');

    // Add timeout to prevent hanging requests
    const response = await axios.post(
      `${baseUrl}/api/v1.0/documentsubmissions`,
      { documents: docs },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        timeout: 30000 // 30 seconds timeout
      }
    );

    if (!response.data) {
      console.error('Empty response data from LHDN API');
      return {
        status: 'failed',
        error: {
          code: 'EMPTY_RESPONSE',
          message: 'LHDN API returned an empty response',
          details: 'The server returned a successful status but with no data. Please try again.'
        }
      };
    }

    console.log('LHDN API Response:', JSON.stringify(response.data, null, 2));
    return { status: 'success', data: response.data };
  } catch (err) {
    // Improved error logging
    console.error('LHDN Submission Error:', {
      status: err.response?.status,
      message: err.message,
      details: err.response?.data?.error?.details || err.response?.data?.details,
      fullResponse: JSON.stringify(err.response?.data, null, 2)
    });

    // Handle rate limiting (429) per Integration Practices
    if (err.response?.status === 429) {
      const retryAfter = err.response.headers['retry-after'] || err.response.headers['x-rate-limit-reset'];
      const baseDelay = parseRetryAfter(retryAfter) || RATE_LIMITS.submitDocuments.minIntervalMs;
      console.warn(`[RateLimit] SubmitDocuments 429. Retry-After: ${retryAfter || 'n/a'}. Base delay ~${baseDelay}ms`);
      await backoffWait(baseDelay, 0);
      return await submitDocument(docs, token);
    }

    // Enhanced error handling with human-readable messages
    const getHumanReadableError = (errorData, defaultMessage = 'Failed to submit document to LHDN. Please check your document and try again.') => {
      const errorCode = errorData?.code || errorData?.error?.code || 'UNKNOWN_ERROR';
      const errorMessage = errorData?.message || errorData?.error?.message || defaultMessage;
      const errorDetails = errorData?.details || errorData?.error?.details || [];

      const errorMap = {
        'DS302': { message: 'This document has already been submitted to LHDN. Please check the document status in LHDN portal.' },
        'CF321': { message: 'Document issue date is invalid. Documents must be submitted within 7 days of issuance.' },
        'CF364': { message: 'Invalid item classification code. Please ensure all items have valid classification codes.' },
        'CF401': { message: 'Tax calculation error. Please verify all tax amounts and calculations in your document.' },
        'CF402': { message: 'Currency error. Please check that all monetary values use the correct currency code.' },
        'CF403': { message: 'Invalid tax code. Please verify the tax codes used in your document.' },
        'CF404': { message: 'Invalid identification. Please check all party identification numbers (TIN, BRN, etc.).' },
        'CF405': { message: 'Invalid party information. Please verify supplier/customer details are complete and valid.' },
        'AUTH001': { message: 'Authentication failure. Your session may have expired, please try logging in again.' },
        'AUTH003': { message: 'Unauthorized access. Your account does not have permission to submit this document.' },
        'VALIDATION_ERROR': { message: 'Document validation failed. Please review the document and correct all errors.' },
        'DUPLICATE_SUBMISSION': { message: 'This document has already been submitted or is being processed.' },
        'E-INVOICE-TIN-VALIDATION-PARTY-VALIDATION': { message: 'TIN validation failed. The document TIN doesn\'t match with your authenticated TIN.' },
        'INVALID_PARAMETER': { message: 'Invalid parameters provided. Please check your document formatting.' },
        'TIN_MISMATCH': { message: 'The Tax Identification Number (TIN) in the document does not match the TIN of the authenticated user.' },
        'SYSTEM_ERROR': { message: 'LHDN system is currently experiencing technical issues. Please try again later or contact LHDN support.' }
      };

      const mappedError = errorMap[errorCode];

      return {
        code: errorCode,
        message: mappedError?.message || errorMessage,
        details: errorDetails.length > 0 ? errorDetails : [{
          code: errorCode,
          message: errorMessage,
          target: docs[0]?.codeNumber || 'Unknown'
        }]
      };
    };

    // Handle specific HTTP status codes
    if (err.response) {
      const { status, data } = err.response;

      switch (status) {
        case 400:
          return { status: 'failed', error: getHumanReadableError(data, 'Invalid document data provided.') };
        case 401:
        case 403:
          return { status: 'failed', error: getHumanReadableError(data, 'Authentication failed or unauthorized access.') };
        case 404:
          return { status: 'failed', error: getHumanReadableError(data, 'The requested resource was not found.') };
        case 500:
          return { status: 'failed', error: getHumanReadableError(data, 'LHDN internal server error.') };
        case 422:
          return { status: 'failed', error: getHumanReadableError(data, 'Duplicate or unprocessable submission.') };
        default:
          return {
            status: 'failed',
            error: {
              code: `HTTP_ERROR_${status}`,
              message: `LHDN API returned HTTP status ${status}`,
              details: data?.message || err.message
            }
          };
      }
    } else if (err.request) {
      console.error('LHDN Submission Error: No response received', err.request);
      return {
        status: 'failed',
        error: { code: 'NO_RESPONSE', message: 'No response received from LHDN API. Please check your network connection or try again later.', details: err.message }
      };
    } else {
      console.error('LHDN Submission Error: Request setup error', err.message);
      return {
        status: 'failed',
        error: { code: 'REQUEST_ERROR', message: 'Error setting up request to LHDN API.', details: err.message }
      };
    }
  }
}

async function getDocumentDetails(irb_uuid, token) {


  try {
    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ? settings.middlewareUrl : settings.middlewareUrl;

    // Respect getDocumentDetails rate limit
    await waitForSlot('getDocumentDetails');

    const response = await axios.get(
      `${baseUrl}/api/v1.0/documents/${irb_uuid}/details`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    return { status: 'success', data: response.data };
  } catch (err) {
    if (err.response?.status === 429) {
      const retryAfter = err.response.headers['retry-after'] || err.response.headers['x-rate-limit-reset'];
      const baseDelay = parseRetryAfter(retryAfter) || RATE_LIMITS.getDocumentDetails.minIntervalMs;
      console.warn(`[RateLimit] GetDocumentDetails 429. Retry-After: ${retryAfter || 'n/a'}. Base delay ~${baseDelay}ms`);
      await backoffWait(baseDelay, 0);
      return await getDocumentDetails(irb_uuid, token);
    }
    console.error(`Failed to get IRB document details for document UUID ${irb_uuid}:`, err.message);
    throw err;
  }
}

// Top-level GetSubmission with rate limit and 429 handling
async function getSubmission(submissionUid, token) {
  try {
    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ? settings.middlewareUrl : settings.middlewareUrl;

    await waitForSlot('getSubmission');

    const response = await axios.get(
      `${baseUrl}/api/v1.0/documentsubmissions/${submissionUid}`,
      {
        params: { pageNo: 1, pageSize: 100 },
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      }
    );

    return { status: 'success', data: response.data };
  } catch (err) {
    if (err.response?.status === 429) {
      const retryAfter = err.response.headers['retry-after'] || err.response.headers['x-rate-limit-reset'];
      const baseDelay = parseRetryAfter(retryAfter) || RATE_LIMITS.getSubmission.minIntervalMs;
      console.warn(`[RateLimit] GetSubmission 429. Retry-After: ${retryAfter || 'n/a'}. Base delay ~${baseDelay}ms`);
      await backoffWait(baseDelay, 0);
      return await getSubmission(submissionUid, token);
    }
    throw err;
  }
}


async function cancelValidDocumentBySupplier(irb_uuid, cancellation_reason, token) {
  try {
    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ?
      settings.middlewareUrl : settings.middlewareUrl;

    const payload = {
      status: 'cancelled',
      reason: cancellation_reason || 'NA'
    };

    const response = await axios.put(
      `${baseUrl}/api/v1.0/documents/state/${irb_uuid}/state`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        }
      }
    );

    return { status: 'success', data: response.data };
  } catch (err) {
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        console.log('=======================================================================================');
        console.log('              LHDN Cancel Document API hitting rate limit HTTP 429                      ');
        console.log('                 Retrying for current iteration.................                       ');
        console.log(`                     (Waiting time: ${waitTime} ms)                                       `);
        console.log('=======================================================================================');

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await cancelValidDocumentBySupplier(irb_uuid, cancellation_reason, token);
        }
      }
    }
    console.error(`Failed to cancel document for IRB UUID ${irb_uuid}:`, err.message);
    throw err;
  }
}

function jsonToBase64(jsonObj) {
    const jsonString = JSON.stringify(jsonObj);
    const base64String = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(jsonString));
    return base64String;
}

function calculateSHA256(jsonObj) {
    const jsonString = JSON.stringify(jsonObj);
    const hash = CryptoJS.SHA256(jsonString);
    return hash.toString(CryptoJS.enc.Hex);
}

function getCertificatesHashedParams(documentJson) {
  //Note: Supply your JSON without Signature and UBLExtensions
  let jsonStringifyData = JSON.stringify(documentJson)
  const minifiedJsonData = jsonminify(jsonStringifyData);

  const sha256Hash = crypto.createHash('sha256').update(minifiedJsonData, 'utf8').digest('base64');
  const docDigest = sha256Hash;

  const privateKeyPath = path.join(__dirname, 'eInvoiceCertificates', process.env.PRIVATE_KEY_FILE_PATH);
  const certificatePath = path.join(__dirname, 'eInvoiceCertificates', process.env.PRIVATE_CERT_FILE_PATH);

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  const certificatePem = fs.readFileSync(certificatePath, 'utf8');

  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);

  const md = forge.md.sha256.create();
  //NOTE DEV: 12/7/2024 - sign the raw json instead of hashed json
  // md.update(docDigest, 'utf8'); //disable this (no longer work)
  md.update(minifiedJsonData, 'utf8'); //enable this
  const signature = privateKey.sign(md);
  const signatureBase64 = forge.util.encode64(signature);

  // =============================================================
  // Calculate cert Digest
  // =============================================================
  const certificate = forge.pki.certificateFromPem(certificatePem);
  const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();

  const sha256 = crypto.createHash('sha256').update(derBytes, 'binary').digest('base64');
  const certDigest = sha256;

  // =============================================================
  // Calculate the signed properties section digest
  // =============================================================
  let signingTime = new Date().toISOString()
  let signedProperties =
  {
    "Target": "signature",
    "SignedProperties": [
      {
        "Id": "id-xades-signed-props",
        "SignedSignatureProperties": [
            {
              "SigningTime": [
                {
                  "_": signingTime
                }
              ],
              "SigningCertificate": [
                {
                  "Cert": [
                    {
                      "CertDigest": [
                        {
                          "DigestMethod": [
                            {
                              "_": "",
                              "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                            }
                          ],
                          "DigestValue": [
                            {
                              "_": certDigest
                            }
                          ]
                        }
                      ],
                      "IssuerSerial": [
                        {
                          "X509IssuerName": [
                            {
                              "_": process.env.X509IssuerName_VALUE
                            }
                          ],
                          "X509SerialNumber": [
                            {
                              "_": process.env.X509SerialNumber_VALUE
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
      }
    ]
  }

  const signedpropsString = JSON.stringify(signedProperties);
  const signedpropsHash = crypto.createHash('sha256').update(signedpropsString, 'utf8').digest('base64');

  // return ({
  //     docDigest, // docDigest
  //     signatureBase64, // sig,
  //     certDigest,
  //     signedpropsHash, // propsDigest
  //     signingTime
  // })

  let certificateJsonPortion_Signature = [
      {
          "ID": [
            {
                "_": "urn:oasis:names:specification:ubl:signature:Invoice"
            }
          ],
          "SignatureMethod": [
            {
                "_": "urn:oasis:names:specification:ubl:dsig:enveloped:xades"
            }
          ]
      }
  ]

  let certificateJsonPortion_UBLExtensions = [
    {
      "UBLExtension": [
        {
          "ExtensionURI": [
            {
              "_": "urn:oasis:names:specification:ubl:dsig:enveloped:xades"
            }
          ],
          "ExtensionContent": [
            {
              "UBLDocumentSignatures": [
                {
                  "SignatureInformation": [
                    {
                      "ID": [
                        {
                          "_": "urn:oasis:names:specification:ubl:signature:1"
                        }
                      ],
                      "ReferencedSignatureID": [
                        {
                          "_": "urn:oasis:names:specification:ubl:signature:Invoice"
                        }
                      ],
                      "Signature": [
                        {
                          "Id": "signature",
                          "SignedInfo": [
                            {
                              "SignatureMethod": [
                                {
                                  "_": "",
                                  "Algorithm": "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"
                                }
                              ],
                              "Reference": [
                                {
                                  "Id": "id-doc-signed-data",
                                  "URI": "",
                                  "DigestMethod": [
                                    {
                                      "_": "",
                                      "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                                    }
                                  ],
                                  "DigestValue": [
                                    {
                                      "_": docDigest
                                    }
                                  ]
                                },
                                {
                                  "Id": "id-xades-signed-props",
                                  "Type": "http://uri.etsi.org/01903/v1.3.2#SignedProperties",
                                  "URI": "#id-xades-signed-props",
                                  "DigestMethod": [
                                    {
                                      "_": "",
                                      "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                                    }
                                  ],
                                  "DigestValue": [
                                    {
                                      "_": signedpropsHash
                                    }
                                  ]
                                }
                              ]
                            }
                          ],
                          "SignatureValue": [
                            {
                              "_": signatureBase64
                            }
                          ],
                          "KeyInfo": [
                            {
                              "X509Data": [
                                {
                                  "X509Certificate": [
                                    {
                                      "_": process.env.X509Certificate_VALUE
                                    }
                                  ],
                                  "X509SubjectName": [
                                    {
                                      "_": process.env.X509SubjectName_VALUE
                                    }
                                  ],
                                  "X509IssuerSerial": [
                                    {
                                      "X509IssuerName": [
                                        {
                                          "_": process.env.X509IssuerName_VALUE
                                        }
                                      ],
                                      "X509SerialNumber": [
                                        {
                                          "_": process.env.X509SerialNumber_VALUE
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ],
                          "Object": [
                            {
                              "QualifyingProperties": [
                                {
                                  "Target": "signature",
                                  "SignedProperties": [
                                    {
                                      "Id": "id-xades-signed-props",
                                      "SignedSignatureProperties": [
                                        {
                                          "SigningTime": [
                                            {
                                              "_": signingTime
                                            }
                                          ],
                                          "SigningCertificate": [
                                            {
                                              "Cert": [
                                                {
                                                  "CertDigest": [
                                                    {
                                                      "DigestMethod": [
                                                        {
                                                          "_": "",
                                                          "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                                                        }
                                                      ],
                                                      "DigestValue": [
                                                        {
                                                          "_": certDigest
                                                        }
                                                      ]
                                                    }
                                                  ],
                                                  "IssuerSerial": [
                                                    {
                                                      "X509IssuerName": [
                                                        {
                                                          "_": process.env.X509IssuerName_VALUE
                                                        }
                                                      ],
                                                      "X509SerialNumber": [
                                                        {
                                                          "_": process.env.X509SerialNumber_VALUE
                                                        }
                                                      ]
                                                    }
                                                  ]
                                                }
                                              ]
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]

  //Use this return value to inject back into your raw JSON Invoice[0] without Signature/UBLExtension earlier
  //Then, encode back to SHA256 and Base64 respectively for object value inside Submission Document payload.
  return ({
    certificateJsonPortion_Signature,
    certificateJsonPortion_UBLExtensions
  })

}

async function testIRBCall(data) {
  try {
    const response = await axios.post(`${process.env.PREPROD_BASE_URL}/connect/token`, httpOptions, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if(response.status == 200) return response.data;
  } catch (err) {
    if (err.response.status == 429) {
      console.log('Current iteration hitting Rate Limit 429 of LHDN Taxpayer Token API, retrying...')
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];

      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        if (waitTime > 0) {
          console.log('=======================================================================================');
          console.log('         (TEST API CALL) LHDN Taxpayer Token API hitting rate limit HTTP 429           ');
          console.log(`              Refetching................. (Waiting time: ${waitTime} ms)               `);
          console.log('=======================================================================================');
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await getTokenAsTaxPayer();
        }
      }
    } else {
      throw new Error(`Failed to get token: ${err.message}`);
    }
  }
}

async function validateCustomerTin(settings, tin, idType, idValue, token) {
  try {
    if (!['NRIC', 'BRN', 'PASSPORT', 'ARMY'].includes(idType)) {
      throw new Error(`Invalid ID type. Only 'NRIC', 'BRN', 'PASSPORT', 'ARMY' are allowed`);
    }

    if (!settings) {
      settings = await getConfig();
    }

    const baseUrl = settings.environment === 'production' ? settings.middlewareUrl : settings.middlewareUrl;

    // Respect Search Taxpayer's TIN rate limit
    await waitForSlot('searchTIN');

    const response = await axios.get(
      `${baseUrl}/api/v1.0/taxpayer/validate/${tin}?idType=${idType}&idValue=${idValue}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (response.status === 200) {
      return { status: 'success' };
    }
  } catch (err) {
    if (err.response?.status === 429) {
      const retryAfter = err.response.headers['retry-after'] || err.response.headers['x-rate-limit-reset'];
      const baseDelay = parseRetryAfter(retryAfter) || RATE_LIMITS.searchTIN.minIntervalMs;
      console.warn(`[RateLimit] Search TIN 429. Retry-After: ${retryAfter || 'n/a'}. Base delay ~${baseDelay}ms`);
      await backoffWait(baseDelay, 0);
      return await validateCustomerTin(settings, tin, idType, idValue, token);
    }
    throw err;
  }
}

module.exports = {
    submitDocument,
    validateCustomerTin,
    getTokenAsIntermediary,
    cancelValidDocumentBySupplier,
    getDocumentDetails,
    jsonToBase64,
    calculateSHA256,
    getCertificatesHashedParams,
    testIRBCall,
    getSubmission
};
