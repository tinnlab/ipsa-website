import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { WebApp } from 'meteor/webapp';
import { storeTokens } from './zohoTokens';

const CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const REDIRECT_URI = process.env.ZOHO_REDIRECT_URI || '';
export const initZohoOAuth = () => {
  const authUrl = 'https://accounts.zoho.com/oauth/v2/auth' +
    '?scope=ZohoMail.messages.ALL,ZohoMail.accounts.ALL' +
    `&client_id=${CLIENT_ID}` +
    '&response_type=code' +
    '&access_type=offline' +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  console.log('Zoho OAuth URL:', authUrl);
  return authUrl;
};

WebApp.connectHandlers.use('/callback', (req, res) => {
  const { code } = req.query;
  console.log({req})
  console.log({code})
  if (code) {
    HTTP.post('https://accounts.zoho.com/oauth/v2/token', {
      params: {
        code: code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
        scope: 'ZohoMail.messages.ALL,ZohoMail.accounts.ALL'
      }
    }, (error, result) => {
      if (error) {
        console.log('Error exchanging code for tokens:', error);
      } else if (result.data && result.data.access_token && result.data.refresh_token) {
        storeTokens(result.data.access_token, result.data.refresh_token, result.data.expires_in);
        console.log('Zoho OAuth successful. Tokens stored.');
      } else {
        console.log('Invalid response from Zoho:', result);
      }
    });
  } else {
    console.log('No authorization code provided.')
  }
});

Meteor.methods({
  'refreshZohoOAuth': function() {
    return initZohoOAuth();
  }
});