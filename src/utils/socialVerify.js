const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
const ApiError = require('./ApiError');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Verifies a Google ID token (obtained client-side via Google Sign-In SDK).
 * Returns normalized profile data.
 */
const verifyGoogleToken = async (idToken) => {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    return {
      provider_id: payload.sub,
      email: payload.email,
      email_verified: payload.email_verified,
      first_name: payload.given_name || '',
      last_name: payload.family_name || '',
      profile_picture: payload.picture || null,
    };
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired Google token');
  }
};

/**
 * Verifies a Facebook access token (obtained client-side via Facebook SDK)
 * by calling the Graph API, and cross-checks it against the app via the
 * debug_token endpoint to prevent token substitution attacks.
 */
const verifyFacebookToken = async (accessToken) => {
  try {
    const appToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;

    const debugResp = await axios.get('https://graph.facebook.com/debug_token', {
      params: { input_token: accessToken, access_token: appToken },
    });

    const debugData = debugResp.data && debugResp.data.data;
    if (!debugData || !debugData.is_valid || debugData.app_id !== process.env.FACEBOOK_APP_ID) {
      throw new Error('Token failed validation');
    }

    const profileResp = await axios.get('https://graph.facebook.com/me', {
      params: {
        fields: 'id,first_name,last_name,email,picture.type(large)',
        access_token: accessToken,
      },
    });

    const profile = profileResp.data;
    return {
      provider_id: profile.id,
      email: profile.email || null,
      first_name: profile.first_name || '',
      last_name: profile.last_name || '',
      profile_picture: profile.picture && profile.picture.data ? profile.picture.data.url : null,
    };
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired Facebook token');
  }
};

module.exports = { verifyGoogleToken, verifyFacebookToken };
