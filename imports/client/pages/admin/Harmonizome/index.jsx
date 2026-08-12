import React from 'react';
import { Meteor } from 'meteor/meteor';
import { Card, Button, message } from 'antd';

const HarmonizomePage = () => {
  const handleHarmoniIntegration = () => {
    Meteor.call('harmoni.getSources', (error) => {
      if (error) {
        console.error('Error starting OAuth:', error);
        message.error('Failed to start Zoho integration. Please try again.');
      } else {
        // window.location.href = authUrl;
      }
    });
  };

  return (
    <div style={{ padding: 24 }}>
      <Card title="Harmonizome Integration" style={{ marginBottom: 16 }}>
        <Button onClick={handleHarmoniIntegration} type="primary">
          Integrate Harmonizome
        </Button>
      </Card>
      {/* Other settings cards */}
    </div>
  );
};

export default HarmonizomePage;