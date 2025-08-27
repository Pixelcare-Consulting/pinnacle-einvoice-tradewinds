/* SubmissionClient: centralizes submission orchestration, throttling, retries, and duplicate prevention
 * Scope: outbound manual submissions UI
 * Exposes window.SubmissionClient with two methods:
 *   - submitSingleFile(fileId, callbacks)
 *   - bulkSubmitFiles(fileIds, callbacks)
 *
 * This module does not own the UI. The caller provides callbacks that forward
 * progress updates to the UI layer (e.g., updateSubmissionFlow, show modals).
 *
 * Design notes
 * - Batches: server endpoint /uploaded-files/:id/submit-single already submits
 *   all invoices in a file in one LHDN batch (<=100). We leverage it.
 * - Throttle: simple client-side limiter to <= 85 RPM by inserting a minimal
 *   delay between requests (700ms). This keeps us comfortably under 100 RPM.
 * - Retries: network-aware exponential backoff for transient errors (429/5xx/timeout)
 * - Timeout: fetch with AbortController; default 120s for submit, 20s for metadata
 * - Duplicate prevention: consult server details + session cache + localStorage
 * - Stepper events: validate -> process -> duplicates -> submit -> done (UI wiring)
 */
(function(){
  const LOG_PREFIX = '[SubmissionClient]';

  // Simple token bucket-ish throttle: ensure at least gapMs between calls
  const gapMs = 700; // ~85 RPM
  let lastCallAt = 0;
  async function throttle(){
    const now = Date.now();
    const wait = Math.max(0, lastCallAt + gapMs - now);
    if (wait > 0) await new Promise(r=>setTimeout(r, wait));
    lastCallAt = Date.now();
  }

  // Fetch with timeout and JSON response
  async function fetchJson(url, options={}, timeoutMs=20000){
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(new Error('Timeout')), timeoutMs);
    try{
      const resp = await fetch(url, { ...options, signal: controller.signal, credentials: 'same-origin' });
      let data = null;
      try { data = await resp.json(); } catch(_){ /* may be empty */ }
      return { ok: resp.ok, status: resp.status, data };
    } catch (err) {
      // Normalize network errors so retry logic can detect them
      const msg = (err && err.message) ? err.message : '';
      if (err && err.name === 'AbortError') {
        err.code = err.code || 'TIMEOUT';
      } else if ((err && err.name === 'TypeError') || /Failed to fetch|ERR_EMPTY_RESPONSE|NetworkError/i.test(msg)) {
        err.code = 0;
        err.status = 0;
      }
      throw err;
    } finally { clearTimeout(timer); }
  }

  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

  // Enforce a minimum visual duration for a step; resolves with the wrapped result
  async function withMinDuration(promiseOrFn, minMs){
    const started = Date.now();
    const result = typeof promiseOrFn === 'function' ? await promiseOrFn() : await promiseOrFn;
    const elapsed = Date.now() - started;
    if (elapsed < minMs) await sleep(minMs - elapsed);
    return result;
  }

  async function retrying(fn, { retries=2, baseDelay=1200 }={}){
    let attempt = 0; let lastErr;
    while(attempt <= retries){
      try{ return await fn(attempt); }catch(err){
        lastErr = err;
        const code = err && (err.code || err.status);
        const shouldRetry = (code===429 || (code>=500 && code<600) || code==='TIMEOUT' || code===0 || err.name==='AbortError');
        if (!shouldRetry || attempt===retries) throw err;
        const backoff = Math.round(baseDelay * Math.pow(2, attempt));
        console.warn(LOG_PREFIX, `retrying in ${backoff}ms (attempt ${attempt+1})`, err?.message || err);
        await sleep(backoff);
        attempt++;
      }
    }
    throw lastErr;
  }

  function getSubmittedCache(){
    try{ return JSON.parse(localStorage.getItem('outbound_submitted_files')||'{}'); }catch(_){ return {}; }
  }
  function setSubmittedCache(map){
    try{ localStorage.setItem('outbound_submitted_files', JSON.stringify(map||{})); }catch(_){ /* ignore */ }
  }

  async function getFileDetails(fileId){
    console.log(LOG_PREFIX, 'fetch details', fileId);
    const res = await fetchJson(`/api/outbound-files-manual/uploaded-files/${fileId}/details`, {
      method: 'GET', headers: { 'Accept': 'application/json' }
    }, 20000);
    if (!res.ok || !res.data?.success) {
      const err = new Error(res.data?.error || 'Failed to get file details');
      err.status = res.status; throw err;
    }
    return res.data.data || {};
  }

  async function postSubmitSingle(fileId){
    console.log(LOG_PREFIX, 'submit-single', fileId);
    const res = await fetchJson(`/api/outbound-files-manual/uploaded-files/${fileId}/submit-single`, {
      method: 'POST', headers: { 'Accept': 'application/json' }
    }, 120000); // allow longer
    if (!res.ok) {
      const err = new Error(res.data?.error || 'Submission failed');
      err.status = res.status; err.payload = res.data; throw err;
    }
    return res.data;
  }

  async function postPrepare(fileId){
    console.log(LOG_PREFIX, 'prepare-documents', fileId);
    const res = await fetchJson(`/api/outbound-files-manual/uploaded-files/${fileId}/prepare`, {
      method: 'POST', headers: { 'Accept': 'application/json' }
    }, 60000);
    if (!res.ok) { const err = new Error(res.data?.error || 'Prepare failed'); err.status = res.status; err.payload=res.data; throw err; }
    return res.data;
  }

  async function postCheckDuplicates(fileId){
    console.log(LOG_PREFIX, 'check-duplicates', fileId);
    const res = await fetchJson(`/api/outbound-files-manual/uploaded-files/${fileId}/check-duplicates`, {
      method: 'POST', headers: { 'Accept': 'application/json' }
    }, 30000);
    if (!res.ok) { const err = new Error(res.data?.error || 'Duplicate check failed'); err.status = res.status; err.payload=res.data; throw err; }
    return res.data;
  }

  async function getSubmissionStatus(submissionUid){
    console.log(LOG_PREFIX, 'get-submission-status', submissionUid);
    const res = await fetchJson(`/api/outbound-files-manual/submission-status/${submissionUid}`, {
      method: 'GET', headers: { 'Accept': 'application/json' }
    }, 30000);
    if (!res.ok) { const err = new Error(res.data?.error || 'Status check failed'); err.status = res.status; err.payload=res.data; throw err; }
    return res.data;
  }

  async function postBulk(fileIds){
    console.log(LOG_PREFIX, 'bulk-submit-files', fileIds.length);
    const res = await fetchJson('/api/outbound-files-manual/bulk-submit-files', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ fileIds })
    }, 30000);
    if (!res.ok) { const err = new Error(res.data?.error || 'Bulk submission failed'); err.status = res.status; throw err; }
    return res.data;
  }

  // Public API
  const SubmissionClient = {
    async submitSingleFile(fileId, { onStage }={}){
      await throttle();
      if (onStage) onStage({ stage:'validate', message:'Fetching file details...', progress:10 });

      // Duplicate prevention (client cache + server status)
      const cache = getSubmittedCache();
      if (cache[fileId]){
        if (onStage) onStage({ stage:'validate', message:'Already submitted previously in this browser session.', progress:12, error:{ userMessage:'This file was already submitted recently.', guidance:['Open Submission History to review results.'] } });
        return { success:false, duplicate:true };
      }

      const details = await withMinDuration(()=>retrying(()=>getFileDetails(fileId), { retries: 1 }), 800);
      const status = (details.processing_status||'').toLowerCase();
      if (!['processed','ready to submit'].includes(status)){
        const err = new Error('File is not ready for submission'); err.status=400; throw err;
      }
      const invoiceCount = parseInt(details.invoice_count || details.metadata?.invoiceCount || 0,10) || 0;
      if (invoiceCount>100){ const err = new Error(`Contains ${invoiceCount} documents which exceeds LHDN limit of 100`); err.status=400; throw err; }

      // Step 2: Processing (preparing JSON documents)
      if (onStage) onStage({ stage:'process', message:'Preparing JSON documents...', progress:35 });
      await withMinDuration(async()=>{
        console.log(LOG_PREFIX, 'STEP process: calling prepare');
        const prep = await postPrepare(fileId);
        console.log(LOG_PREFIX, 'prepare result', prep?.success, prep?.data?.preparedCount);
      }, 1500);

      // Step 3: Duplicate check
      console.log(LOG_PREFIX, 'STEP 3 START: duplicates check');
      if (onStage) onStage({ stage:'duplicates', message:'Checking for duplicate submissions on LHDN...', progress:55 });
      await withMinDuration(async()=>{
        console.log(LOG_PREFIX, 'STEP duplicates: calling check for fileId', fileId);
        try {
          const dup = await postCheckDuplicates(fileId);
          console.log(LOG_PREFIX, 'duplicates result SUCCESS', dup?.success);
          console.log(LOG_PREFIX, 'duplicates found:', dup?.data?.duplicates?.length);
          console.log(LOG_PREFIX, 'warnings found:', dup?.data?.warnings?.length);
          console.log(LOG_PREFIX, 'invoices checked:', dup?.data?.invoiceCount);
          console.log(LOG_PREFIX, 'LHDN compliant:', dup?.data?.lhdnCompliant);
          if (dup?.data?.duplicates?.length > 0) {
            console.warn(LOG_PREFIX, 'DUPLICATES DETECTED:', dup.data.duplicates);
          }
          if (dup?.data?.warnings?.length > 0) {
            console.warn(LOG_PREFIX, 'WARNINGS:', dup.data.warnings);
          }
        } catch (err) {
          console.error(LOG_PREFIX, 'duplicates check FAILED', err);
          throw err;
        }
      }, 900);
      console.log(LOG_PREFIX, 'STEP 3 COMPLETE: duplicates check done');

      // Pause: confirm before submit (client UX requirement)
      console.log(LOG_PREFIX, 'STEP 3.5: checking for confirmBeforeSubmit hook');
      if (window.SubmissionFlowHooks?.confirmBeforeSubmit){
        console.log(LOG_PREFIX, 'confirmBeforeSubmit hook found, calling it');
        const proceed = await window.SubmissionFlowHooks.confirmBeforeSubmit({ fileId, invoiceCount });
        console.log(LOG_PREFIX, 'confirmBeforeSubmit result:', proceed);
        if (!proceed){
          console.log(LOG_PREFIX, 'User cancelled before submit');
          const err = new Error('User cancelled before submit'); err.status = 'CANCELLED'; throw err;
        }
      } else {
        console.log(LOG_PREFIX, 'No confirmBeforeSubmit hook found, proceeding');
      }

      console.log(LOG_PREFIX, 'STEP 4 START: submitting to LHDN');
      let result;
      try {
        result = await retrying(async (attempt)=>{
          console.log(LOG_PREFIX, 'submit attempt', attempt, 'for fileId', fileId);

          // Enhanced Step 4 with real-time progress
          if (onStage) {
            try {
              console.log(LOG_PREFIX, 'Getting file details for fileId:', fileId);
              // Get file metadata for progress tracking
              const fileData = await fetchJson(`/api/outbound-files-manual/uploaded-files/${fileId}/details`, {
                method: 'GET', headers: { 'Accept': 'application/json' }
              }, 10000);

              const invoiceCount = fileData?.data?.metadata?.prepared?.invoiceNumbers?.length || 0;
              const firstInvoice = fileData?.data?.metadata?.prepared?.invoiceNumbers?.[0] || 'Unknown';

              onStage({
                stage:'submit',
                message:`Submitting ${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'} to LHDN...${attempt?` (retry ${attempt})`:''}`,
                progress: 70,
                realTimeInfo: {
                  currentInvoice: firstInvoice,
                  totalInvoices: invoiceCount,
                  processed: 0,
                  remaining: invoiceCount
                }
              });
            } catch (fileDataErr) {
              console.warn(LOG_PREFIX, 'Failed to get file metadata for progress tracking:', fileDataErr);
              // Fallback to basic message without real-time info
              onStage({
                stage:'submit',
                message:`Submitting to LHDN...${attempt?` (retry ${attempt})`:''}`,
                progress: 70
              });
            }
          }

          const r = await postSubmitSingle(fileId);
          console.log(LOG_PREFIX, 'submit result', r?.success);

          // Track submission status if we have a submissionUid
          if (r?.success && r?.data?.submissionUid && onStage) {
            try {
              console.log(LOG_PREFIX, 'Getting submission status for UID:', r.data.submissionUid);
              const statusData = await getSubmissionStatus(r.data.submissionUid);
              if (statusData?.success && statusData?.data?.success) {
                const docCount = statusData.data?.details?.documentCount || 0;
                const lhdnStatus = statusData.data?.status || 'processing';
                console.log(LOG_PREFIX, 'LHDN status update:', lhdnStatus, 'docs:', docCount);

                onStage({
                  stage:'submit',
                  message:`Processing ${docCount} document${docCount === 1 ? '' : 's'} on LHDN...`,
                  progress: 85,
                  realTimeInfo: {
                    submissionUid: r.data.submissionUid,
                    status: lhdnStatus,
                    totalInvoices: docCount,
                    processed: docCount,
                    remaining: 0
                  }
                });
              } else {
                console.warn(LOG_PREFIX, 'Submission status check failed:', statusData);
              }
            } catch (statusErr) {
              console.warn(LOG_PREFIX, 'Failed to get submission status:', statusErr);
            }
          }

          return r;
        }, { retries: 1, baseDelay: 2000 });
      } catch (err) {
        // Network fallback: request may have been processed server-side even if the socket dropped
        const isNetworkish = (err && (err.code===0 || err.status===0 || err.name==='AbortError' || /Failed to fetch|ERR_EMPTY_RESPONSE|NetworkError/i.test(err.message||'')));
        if (isNetworkish) {
          console.warn(LOG_PREFIX, 'network error during submit, attempting fallback verification');
          if (onStage) onStage({ stage:'submit', message:'Submission dispatched. Verifying status...', progress:80 });
          try {
            await sleep(4000);
            const details = await getFileDetails(fileId);
            const resp = details?.lhdn_response || details?.metadata?.lhdn_response;
            const status = (details?.processing_status||'').toLowerCase();
            if ((resp && (resp.status==='success' || resp?.data?.acceptedDocuments?.length>0)) || status==='submitted'){
              // Synthesize a success-like result
              result = { success:true, data: { submissionUid: resp?.data?.submissionUid }, lhdnResponse: resp };
            } else {
              throw err; // not verifiable as success
            }
          } catch (verifyErr) {
            throw err; // bubble original
          }
        } else {
          throw err;
        }
      }
      console.log(LOG_PREFIX, 'STEP 4 COMPLETE: LHDN submission done');

      if (onStage) onStage({ stage:'done', message:'Processing response...', progress:90 });

      if (result?.success){
        // Mark in cache to prevent re-submit in this session
        const c = getSubmittedCache(); c[fileId] = { at: Date.now() }; setSubmittedCache(c);
        if (onStage) onStage({ stage:'done', message:'Finalizing...', progress:98 });
        return { success:true, data: result };
      } else {
        const err = new Error(result?.error || 'Submission failed'); err.payload = result; throw err;
      }
    },

    async bulkSubmitFiles(fileIds, { onStage }={}){
      if (!Array.isArray(fileIds) || fileIds.length===0) return { success:false };
      await throttle();
      if (onStage) onStage({ stage:'validate', message:'Checking file readiness...', progress:10 });
      if (onStage) onStage({ stage:'prepare', message:'Preparing bulk submission...', progress:35 });
      const res = await retrying(()=>postBulk(fileIds), { retries: 1, baseDelay: 1500 });
      if (onStage) onStage({ stage:'submit', message:'Submitting to LHDN (background)...', progress:65 });
      if (!res?.success) { const err = new Error(res?.error||'Bulk submission failed'); err.payload=res; throw err; }
      if (onStage) onStage({ stage:'response', message:'Bulk submission started. Finalizing...', progress:90 });
      return res;
    }
  };

  window.SubmissionClient = SubmissionClient;
})();

