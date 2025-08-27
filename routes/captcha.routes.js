const express = require('express');
const router = express.Router();
const captchaService = require('../services/captcha.service');
const { SecurityMiddleware } = require('../middleware/security.middleware');

/**
 * CAPTCHA Routes
 */

// Generate new CAPTCHA challenge
router.get('/challenge', async (req, res) => {
  try {
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                     req.headers['x-real-ip'] ||
                     req.connection.remoteAddress ||
                     req.ip;

    // Check if CAPTCHA is required for this IP
    // This would typically be based on failed login attempts
    const challenge = captchaService.generateChallenge();
    
    res.json({
      success: true,
      data: {
        challengeId: challenge.challengeId,
        question: challenge.question,
        expiresAt: challenge.expiresAt
      }
    });
  } catch (error) {
    console.error('CAPTCHA challenge generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate CAPTCHA challenge'
    });
  }
});

// Get CAPTCHA image (SVG)
router.get('/image/:challengeId', async (req, res) => {
  try {
    const { challengeId } = req.params;
    
    // Get challenge data to generate image
    const challenge = captchaService.challenges.get(challengeId);
    
    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found or expired'
      });
    }
    
    // Generate question from stored answer (reverse engineering for display)
    // This is a simplified approach - in production, you'd store the question too
    const question = `Math Challenge`;
    
    const svg = captchaService.generateSVGCaptcha(question);
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    res.send(svg);
  } catch (error) {
    console.error('CAPTCHA image generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate CAPTCHA image'
    });
  }
});

// Verify CAPTCHA response (supports both math challenges and hCaptcha)
router.post('/verify', async (req, res) => {
  try {
    const { challengeId, answer, hcaptchaToken } = req.body;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                     req.headers['x-real-ip'] ||
                     req.connection.remoteAddress ||
                     req.ip;

    // If hCaptcha token is provided, verify it
    if (hcaptchaToken) {
      const result = await captchaService.verifyHCaptcha(hcaptchaToken, clientIP);

      if (result.success) {
        res.json({
          success: true,
          message: 'CAPTCHA verified successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.error || 'CAPTCHA verification failed'
        });
      }
      return;
    }

    // Fallback to math challenge verification
    if (!challengeId || answer === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Challenge ID and answer, or hCaptcha token are required'
      });
    }

    const result = captchaService.verifyChallenge(challengeId, answer);

    if (result.success) {
      res.json({
        success: true,
        message: 'CAPTCHA verified successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.error,
        attemptsRemaining: result.attemptsRemaining
      });
    }
  } catch (error) {
    console.error('CAPTCHA verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify CAPTCHA'
    });
  }
});

// Check if CAPTCHA is required for current session/IP
router.get('/required', async (req, res) => {
  try {
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                     req.headers['x-real-ip'] ||
                     req.connection.remoteAddress ||
                     req.ip;

    // Get failed attempt count from query or session
    const failedAttempts = parseInt(req.query.attempts) || 0;
    
    const required = captchaService.isCaptchaRequired(clientIP, failedAttempts);
    
    res.json({
      success: true,
      data: {
        required,
        threshold: 2, // From auth config
        currentAttempts: failedAttempts,
        provider: 'hcaptcha'
      }
    });
  } catch (error) {
    console.error('CAPTCHA requirement check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check CAPTCHA requirement'
    });
  }
});

// Get CAPTCHA statistics (admin only)
router.get('/stats', SecurityMiddleware.requireAdmin, async (req, res) => {
  try {
    const stats = captchaService.getStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('CAPTCHA stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get CAPTCHA statistics'
    });
  }
});

// Test hCaptcha configuration (admin only)
router.post('/test', SecurityMiddleware.requireAdmin, async (req, res) => {
  try {
    const { testToken } = req.body;
    
    if (!testToken) {
      return res.status(400).json({
        success: false,
        message: 'Test token is required'
      });
    }
    
    const result = await captchaService.verifyHCaptcha(testToken);
    
    res.json({
      success: true,
      data: {
        verificationResult: result,
        configurationStatus: {
          siteKeyConfigured: !!process.env.HCAPTCHA_SITE_KEY,
          secretKeyConfigured: !!process.env.HCAPTCHA_SECRET_KEY,
          captchaEnabled: captchaService.getStats().enabled
        }
      }
    });
  } catch (error) {
    console.error('CAPTCHA test error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test CAPTCHA configuration'
    });
  }
});

module.exports = router;
