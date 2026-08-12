import { Meteor } from 'meteor/meteor';
import axios from 'axios';
import { getZohoAccessToken, refreshZohoToken } from '../../helper/zohoTokens';
import { initZohoOAuth } from '../../helper/zohoAuth';
import Permission from '../helper/Permission';

const getZohoAccount = async (accessToken) => {
  try {
    console.log({accessToken});
    const response = await axios.get('https://mail.zoho.com/api/accounts', {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    console.log({response});
    if (response.status === 200 && response.data && response.data.data && response.data.data.length > 0) {
      console.log('Zoho account fetched:', response.data.data[0].accountId);
      return response.data.data[0].accountId;
    } else {
      console.error('Failed to fetch Zoho account');
    }
  } catch (error) {
    console.error('Error fetching Zoho account:', error.response ? error.response.data : error.message);
  }
};

const sendEmailWithAccount = async (accountId, emailData, accessToken) => {
  try {
    const response = await axios.post(`https://mail.zoho.com/api/accounts/${accountId}/messages`, emailData, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 200) {
      return response.data;
    } else {
      console.error('Failed to send email', response.data);
    }
  } catch (error) {
    console.error('Error sending Zoho email:', error.response ? error.response.data : error.message);
  }
};

const sendEmailWithRetry = async (emailData, retryCount = 0) => {
  try {
    const accessToken = await getZohoAccessToken();
    const accountId = await getZohoAccount(accessToken);
    return await sendEmailWithAccount(accountId, emailData, accessToken);
  } catch (error) {
    if (error.response && error.response.status === 401 && retryCount < 2) {
      console.log('Token might be expired. Attempting to refresh...');
      try {
        await refreshZohoToken();
        console.log('Token refreshed successfully. Retrying email send...');
        return sendEmailWithRetry(emailData, retryCount + 1);
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
      }
    } else {
      console.error('Error in sendEmailWithRetry:', error.message);
    }
  }
};

Meteor.methods({
  async sendZohoEmail(emailData) {
    // An unauthenticated client could send arbitrary mail from the lab's own domain — an open
    // relay for spam or phishing that would be attributed to the sending domain. Server-to-server
    // callers (the account-recovery flow) have no connection and are allowed through; a client
    // call must be an operator.
    if (this.connection) {
      await Permission.isAdmin(this.userId);
    }
    try {
      const result = await sendEmailWithRetry(emailData);
      console.log('Email sent successfully');
      return result;
    } catch (error) {
      console.error('Failed to send email:', error.message);
    }
  },

  startZohoOAuth() {
    try {
      const authUrl = initZohoOAuth();
      console.log(`User ${this.userId} initiated Zoho OAuth process`);
      return authUrl;
    } catch (error) {
      console.error('Error initiating Zoho OAuth:', error.message);
    }
  }
});