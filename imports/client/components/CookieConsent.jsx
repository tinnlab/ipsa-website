import React, { useState, useEffect } from 'react';
import { Button, Space, Typography } from 'antd';
import { hasConsentBeenAsked, setConsent } from '../utils/cookieManager';

const { Text, Link } = Typography;

const CookieConsent = () => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        // Show banner only if consent hasn't been asked yet
        if (!hasConsentBeenAsked()) {
            setVisible(true);
        }
    }, []);

    const handleAccept = () => {
        setConsent(true);
        setVisible(false);
    };

    const handleDecline = () => {
        setConsent(false);
        setVisible(false);
    };

    if (!visible) {
        return null;
    }

    return (
        <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: '#fff',
            borderTop: '2px solid #1890ff',
            padding: '16px 24px',
            boxShadow: '0 -2px 8px rgba(0, 0, 0, 0.15)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px'
        }}>
            <div style={{ flex: '1 1 auto', minWidth: '300px' }}>
                <Text strong style={{ fontSize: '16px', display: 'block', marginBottom: '8px' }}>
                    🍪 Cookie Notice
                </Text>
                <Text style={{ fontSize: '14px', color: '#666' }}>
                    We use cookies to improve your experience on our website.
                    By clicking "Accept", you consent to our use of cookies for essential functionality
                    and user preferences (such as theme settings).
                    {' '}
                    <Link href={`${urlPrefix}/contact`} target="_blank" style={{ fontSize: '14px' }}>
                        Learn more
                    </Link>
                </Text>
            </div>
            <Space style={{ flexShrink: 0 }}>
                <Button onClick={handleDecline} size="large">
                    Decline
                </Button>
                <Button type="primary" onClick={handleAccept} size="large">
                    Accept
                </Button>
            </Space>
        </div>
    );
};

export default CookieConsent;
