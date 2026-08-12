import { Mongo } from 'meteor/mongo';
import axios from 'axios';

const ZohoTokens = new Mongo.Collection('zohoTokens');

// This collection is deliberately NOT in DBCollections, so the blanket deny in
// server/startup/lockdown.js does not reach it. Declared here instead: without a rule it stays in
// insecure mode (the `insecure` package is still installed), leaving the default /zohoTokens/update
// DDP method open to any client — on a collection holding Zoho OAuth access and refresh tokens.
ZohoTokens.deny({
    insert: () => true,
    update: () => true,
    remove: () => true,
    insertAsync: () => true,
    updateAsync: () => true,
    removeAsync: () => true,
    fetch: [],
});

ZohoTokens.rawCollection().createIndex({ type: 1 }, { unique: true });

export const storeTokens = async (accessToken, refreshToken, expiresIn) => {
  const expiresAt = new Date(new Date().getTime() + expiresIn * 1000);

  try {
    await ZohoTokens.upsertAsync(
      { type: 'zoho' },
      {
        $set: {
          accessToken,
          refreshToken,
          expiresAt
        }
      }
    );
    console.log('Tokens stored successfully');
  } catch (error) {
    console.error('Error storing tokens:', error);
    // throw error;
  }
};

const getTokens = async () => {
  try {
    const tokens = await ZohoTokens.findOneAsync({ type: 'zoho' });
    if (!tokens) {
      console.log('No Zoho tokens found in database');
    }
    return tokens;
  } catch (error) {
    console.error('Error fetching tokens:', error);
    // throw error;
  }
};

export const refreshZohoToken = async () => {
  try {
    const tokens = await getTokens();
    if (!tokens || !tokens.refreshToken) {
      console.error('No refresh token available');
      return;
    }

    const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        refresh_token: tokens.refreshToken,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token'
      }
    });

    if (response.data && response.data.access_token) {
      await ZohoTokens.updateAsync({ type: 'zoho' }, {
        $set: {
          accessToken: response.data.access_token,
          expiresAt: new Date(Date.now() + response.data.expires_in * 1000)
        }
      });
      console.log('Token refreshed successfully');
      return response.data.access_token;
    } else {
      console.error('Invalid response while refreshing token');
    }
  } catch (error) {
    console.error('Error refreshing Zoho token:', error.response ? error.response.data : error.message);
  }
};

export const getZohoAccessToken = async () => {
  try {
    const tokens = await getTokens();
    if (!tokens) {
      console.error('No tokens found');
      return;
    }

    if (new Date() > tokens.expiresAt) {
      return await refreshZohoToken();
    }

    return tokens.accessToken;
  } catch (error) {
    console.error('Error getting Zoho access token:', error);
  }
};