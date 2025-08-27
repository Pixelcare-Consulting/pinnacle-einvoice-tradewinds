const crypto = require('crypto');
const authConfig = require('../config/auth.config');
const hcaptcha = require('hcaptcha');
const axios = require('axios');

/**
 * Simple CAPTCHA Service
 * Generates mathematical challenges for bot protection
 */
class CaptchaService {
  constructor() {
    // Store active challenges in memory
    this.challenges = new Map();
    
    // Cleanup expired challenges every 5 minutes
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }
  
  /**
   * Generate a new CAPTCHA challenge
   */
  generateChallenge() {
    const challengeId = crypto.randomBytes(16).toString('hex');
    
    // Generate simple math problem
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    const operations = ['+', '-', '*'];
    const operation = operations[Math.floor(Math.random() * operations.length)];
    
    let answer;
    let question;
    
    switch (operation) {
      case '+':
        answer = num1 + num2;
        question = `${num1} + ${num2}`;
        break;
      case '-':
        // Ensure positive result
        const larger = Math.max(num1, num2);
        const smaller = Math.min(num1, num2);
        answer = larger - smaller;
        question = `${larger} - ${smaller}`;
        break;
      case '*':
        answer = num1 * num2;
        question = `${num1} × ${num2}`;
        break;
    }
    
    // Store challenge with expiration (5 minutes)
    const expiresAt = Date.now() + (5 * 60 * 1000);
    this.challenges.set(challengeId, {
      answer,
      expiresAt,
      attempts: 0
    });
    
    return {
      challengeId,
      question,
      expiresAt
    };
  }
  
  /**
   * Verify CAPTCHA response
   */
  verifyChallenge(challengeId, userAnswer) {
    const challenge = this.challenges.get(challengeId);
    
    if (!challenge) {
      return {
        success: false,
        error: 'Invalid or expired challenge'
      };
    }
    
    // Check if expired
    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(challengeId);
      return {
        success: false,
        error: 'Challenge has expired'
      };
    }
    
    // Increment attempt count
    challenge.attempts++;
    
    // Limit attempts per challenge
    if (challenge.attempts > 3) {
      this.challenges.delete(challengeId);
      return {
        success: false,
        error: 'Too many attempts for this challenge'
      };
    }
    
    // Verify answer
    const isCorrect = parseInt(userAnswer) === challenge.answer;
    
    if (isCorrect) {
      // Remove challenge after successful verification
      this.challenges.delete(challengeId);
      return {
        success: true
      };
    } else {
      return {
        success: false,
        error: 'Incorrect answer',
        attemptsRemaining: 3 - challenge.attempts
      };
    }
  }
  
  /**
   * Verify hCaptcha token with enhanced error handling
   */
  async verifyHCaptcha(token, remoteip = null) {
    try {
      if (!authConfig.security.captcha.secretKey) {
        console.warn('hCaptcha secret key not configured');
        return {
          success: false,
          error: 'CAPTCHA service not properly configured',
          errorCode: 'MISSING_SECRET_KEY'
        };
      }

      if (!token) {
        return {
          success: false,
          error: 'CAPTCHA token is required',
          errorCode: 'MISSING_TOKEN'
        };
      }

      // Use the direct hCaptcha API for better control
      const response = await axios.post('https://api.hcaptcha.com/siteverify', 
        new URLSearchParams({
          secret: authConfig.security.captcha.secretKey,
          response: token,
          ...(remoteip && { remoteip })
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000 // 10 second timeout
        }
      );

      const result = response.data;
      
      // Enhanced logging for debugging
      if (!result.success) {
        console.warn('hCaptcha verification failed:', {
          errorCodes: result['error-codes'],
          hostname: result.hostname,
          timestamp: result.challenge_ts
        });
      }

      return {
        success: result.success,
        error: result.success ? null : this.getHCaptchaErrorMessage(result['error-codes']),
        errorCodes: result['error-codes'],
        hostname: result.hostname,
        challenge_ts: result.challenge_ts,
        score: result.score // For enterprise accounts
      };
    } catch (error) {
      console.error('hCaptcha verification error:', error.message);
      
      // Handle specific error types
      if (error.code === 'ECONNABORTED') {
        return {
          success: false,
          error: 'CAPTCHA verification timeout',
          errorCode: 'TIMEOUT'
        };
      }
      
      if (error.response && error.response.status) {
        return {
          success: false,
          error: `CAPTCHA verification failed with status ${error.response.status}`,
          errorCode: 'HTTP_ERROR'
        };
      }
      
      return {
        success: false,
        error: 'CAPTCHA verification service error',
        errorCode: 'SERVICE_ERROR'
      };
    }
  }

  /**
   * Get human-readable error message from hCaptcha error codes
   */
  getHCaptchaErrorMessage(errorCodes) {
    if (!errorCodes || !Array.isArray(errorCodes)) {
      return 'CAPTCHA verification failed';
    }

    const errorMessages = {
      'missing-input-secret': 'Missing secret key',
      'invalid-input-secret': 'Invalid secret key',
      'missing-input-response': 'Missing CAPTCHA response',
      'invalid-input-response': 'Invalid CAPTCHA response',
      'bad-request': 'Bad request to CAPTCHA service',
      'invalid-or-already-seen-response': 'CAPTCHA response already used',
      'not-using-dummy-passcode': 'Using invalid test passcode',
      'sitekey-secret-mismatch': 'Site key and secret key mismatch'
    };

    const firstError = errorCodes[0];
    return errorMessages[firstError] || `CAPTCHA verification failed: ${firstError}`;
  }

  /**
   * Check if CAPTCHA is required for an IP
   */
  isCaptchaRequired(ip, failedAttempts = 0) {
    if (!authConfig.security.captcha.enabled) {
      return false;
    }

    return failedAttempts >= authConfig.security.captcha.triggerThreshold;
  }
  
  /**
   * Generate SVG CAPTCHA image
   */
  generateSVGCaptcha(question) {
    const width = 200;
    const height = 60;
    const fontSize = 20;
    
    // Add some visual noise
    const noise = Array.from({ length: 5 }, () => {
      const x1 = Math.random() * width;
      const y1 = Math.random() * height;
      const x2 = Math.random() * width;
      const y2 = Math.random() * height;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ddd" stroke-width="1"/>`;
    }).join('');
    
    // Random background dots
    const dots = Array.from({ length: 20 }, () => {
      const cx = Math.random() * width;
      const cy = Math.random() * height;
      const r = Math.random() * 2 + 1;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#eee"/>`;
    }).join('');
    
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f8f9fa"/>
        ${dots}
        ${noise}
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
              font-family="Arial, sans-serif" font-size="${fontSize}" 
              font-weight="bold" fill="#333" 
              transform="rotate(${Math.random() * 10 - 5} ${width/2} ${height/2})">
          ${question} = ?
        </text>
      </svg>
    `;
    
    return svg;
  }
  
  /**
   * Cleanup expired challenges
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [challengeId, challenge] of this.challenges.entries()) {
      if (now > challenge.expiresAt) {
        this.challenges.delete(challengeId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} expired CAPTCHA challenges`);
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      activeChallenges: this.challenges.size,
      enabled: authConfig.security.captcha.enabled,
      triggerThreshold: authConfig.security.captcha.triggerThreshold
    };
  }
}

// Create singleton instance
const captchaService = new CaptchaService();

module.exports = captchaService;
