import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import Spin from 'antd/lib/spin';
import Result from 'antd/lib/result';
import Button from 'antd/lib/button';

const ProtectedAdminRoute = ({ children }) => {
    const location = useLocation();
    
    const user = useTracker(() => Meteor.user(), []);

    // If user is not logged in, redirect to login with intended location
    if (!user) {
        return <Navigate to={`${urlPrefix}/admin/login`} state={{ from: location }} replace />;
    }

    // Check if user has admin role
    const isAdmin = user.profile?.roles?.includes('admin');
    
    if (!isAdmin) {
        return (
            <Result
                status="403"
                title="403 Unauthorized"
                subTitle="You don't have permission to access this admin page."
                extra={
                    <Button type="primary" onClick={() => window.history.back()}>
                        Go Back
                    </Button>
                }
            />
        );
    }

    // User is authenticated and is admin, render the protected component
    return children;
};

export default ProtectedAdminRoute;