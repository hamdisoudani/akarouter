import logging
import httpx

logger = logging.getLogger(__name__)

RECAPTCHA_SECRET = "6LcnqxUtAAAAAJZ0XjDCmVLNrH8gVmrS_sR1u7U0"

async def verify_recaptcha(token: str) -> bool:
    """
    Verify Google reCAPTCHA v3 token.
    Returns True if verification is successful and score >= 0.5, False otherwise.
    """
    if not token:
        logger.warning("reCAPTCHA: Empty token provided for verification")
        return False
        
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                "https://www.google.com/recaptcha/api/siteverify",
                data={
                    "secret": RECAPTCHA_SECRET,
                    "response": token
                }
            )
            if response.status_code != 200:
                logger.error(f"reCAPTCHA: Google API returned status code {response.status_code}")
                return False
                
            res_data = response.json()
            success = res_data.get("success", False)
            score = res_data.get("score", 0.0)
            
            logger.info(f"reCAPTCHA verification: success={success}, score={score}")
            return success and score >= 0.5
    except Exception as e:
        logger.error(f"reCAPTCHA verification error: {e}")
        return False
