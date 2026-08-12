import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Form from "antd/lib/form"
import Input from "antd/lib/input"
import Button from "antd/lib/button"
import Layout from "antd/lib/layout/layout";

import './index.style.less'
import Typography from "antd/lib/typography";

const Login = () => {
    const navigate = useNavigate();
    const location = useLocation();
    
    // Get the intended destination or default to admin organism page
    const from = location.state?.from?.pathname || `${urlPrefix}/admin/organism`;

    const layout = {
        labelCol: {span: 8},
        wrapperCol: {span: 16},
    };

    const tailLayout = {
        wrapperCol: {offset: 8, span: 16},
    };

    const onFinish = (values) => {
        Meteor.loginWithPassword({username: values.username}, values.password, (err) => {
            if (err) return notify.error(err.reason)
            
            // Check if user has admin role after login
            const user = Meteor.user();
            if (user?.profile?.roles?.includes('admin')) {
                navigate(from, { replace: true });
            } else {
                notify.error("Admin access required");
                Meteor.logout();
            }
        })
    };

    return (
        <Layout className={"admin-login-wrapper"}>

            <Typography.Title level={1} className={"title"}>
                LOGIN
            </Typography.Title>

            <Form
                {...layout}
                name="basic"
                initialValues={{remember: true}}
                onFinish={onFinish}
                className={"login-form"}
            >
                <Form.Item
                    label="Username"
                    name="username"
                    rules={[{required: true, message: 'Please input your username!'}]}
                >
                    <Input/>
                </Form.Item>

                <Form.Item
                    label="Password"
                    name="password"
                    rules={[{required: true, message: 'Please input your password!'}]}
                >
                    <Input.Password/>
                </Form.Item>

                <Form.Item {...tailLayout}>
                    <Button type="primary" htmlType="submit">
                        Submit
                    </Button>
                </Form.Item>
            </Form>
        </Layout>
    );
}

export default Login;
