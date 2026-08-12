import { Meteor } from 'meteor/meteor';
import * as schedule from "node-schedule"
import path from "path"
import fs from "fs"
import { refreshZohoToken } from '../helper/zohoTokens'; // Import the refresh function
Meteor.startup(() => {
  // schedule.scheduleJob('*/30 * * * *', async function () {
  //   console.log('Running Zoho token refresh job');
  //   try {
  //     await refreshZohoToken();
  //     console.log('Zoho token refreshed successfully');
  //   } catch (error) {
  //     console.error('Failed to refresh Zoho token:', error);
  //   }
  // });
});