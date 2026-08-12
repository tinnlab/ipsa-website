import React from 'react';
import { Meteor } from 'meteor/meteor';
import { Card, Button, message } from 'antd';

const AdminSettingsPage = () => {
  const handleZohoOAuth = () => {
    Meteor.call('startZohoOAuth', (error, authUrl) => {
      if (error) {
        console.error('Error starting OAuth:', error);
        message.error('Failed to start Zoho integration. Please try again.');
      } else {
        window.location.href = authUrl;
      }
    });
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>Admin Settings</h1>
      <Card title="Email Integration" style={{ marginBottom: 16 }}>
        <p>Integrate with Zoho to enable email functionality:</p>
        <Button onClick={handleZohoOAuth} type="primary">
          Connect Zoho
        </Button>
      </Card>
      {/* Other settings cards */}
    </div>
  );
};

export default AdminSettingsPage;