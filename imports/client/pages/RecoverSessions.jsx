import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Meteor } from 'meteor/meteor';
import { Result, Spin, Button, Layout } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { Helmet } from 'react-helmet';

const { Content } = Layout;

export default function RecoverSessions() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');

    const [status, setStatus] = useState('loading'); // loading, success, error
    const [message, setMessage] = useState('');
    const [recoveredCount, setRecoveredCount] = useState(0);

    useEffect(() => {
        if (!token) {
            setStatus('error');
            setMessage('No recovery token provided. Please use the link from your email.');
            return;
        }

        // Automatically attempt recovery
        const performRecovery = async () => {
            try {
                const result = await Meteor.callAsync('session.completeEmailRecovery', { token });

                setStatus('success');
                setRecoveredCount(result.recoveredCount);
                setMessage(result.message || `Successfully recovered ${result.recoveredCount} study/studies!`);

                // Redirect to recent studies after 3 seconds
                setTimeout(() => {
                    navigate(`${urlPrefix}/analysis/recent-studies`);
                }, 3000);

                notify.success(`${result.recoveredCount} study/studies recovered!`);
            } catch (error) {
                setStatus('error');
                setMessage(error.reason || 'Recovery failed. The link may be invalid or expired.');
                notify.error(error.reason || 'Recovery failed');
            }
        };

        performRecovery();
    }, [token, navigate]);

    const handleGoToSessions = () => {
        navigate(`${urlPrefix}/analysis/recent-studies`);
    };

    const renderContent = () => {
        if (status === 'loading') {
            return (
                <div style={{ textAlign: 'center', padding: '100px 20px' }}>
                    <Spin
                        indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />}
                        size="large"
                    />
                    <h2 style={{ marginTop: 20 }}>Recovering your studies...</h2>
                    <p style={{ color: '#666' }}>Please wait while we transfer your studies.</p>
                </div>
            );
        }

        if (status === 'success') {
            return (
                <Result
                    status="success"
                    title="Studies Recovered Successfully!"
                    subTitle={
                        <div>
                            <p>{message}</p>
                            <p style={{ marginTop: 10, color: '#666' }}>
                                You'll be redirected to your studies in a few seconds...
                            </p>
                        </div>
                    }
                    extra={[
                        <Button type="primary" key="go" onClick={handleGoToSessions}>
                            Go to My Studies Now
                        </Button>
                    ]}
                />
            );
        }

        // Error state
        return (
            <Result
                status="error"
                title="Recovery Failed"
                subTitle={message}
                extra={[
                    <Button type="primary" key="sessions" onClick={handleGoToSessions}>
                        Go to Studies
                    </Button>,
                    <Button
                        key="retry"
                        onClick={() => window.location.href = `${urlPrefix}/analysis/recent-studies`}
                    >
                        Request New Recovery Link
                    </Button>
                ]}
            />
        );
    };

    return (
        <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
            <Helmet>
                <title>Recover Studies - IPSA Platform</title>
            </Helmet>
            <Content style={{ padding: '50px 20px', maxWidth: 800, margin: '0 auto', width: '100%' }}>
                {renderContent()}
            </Content>
        </Layout>
    );
}
