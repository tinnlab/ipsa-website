import React from 'react';
import { Layout, Typography, Row, Col } from 'antd';
import { Helmet } from "react-helmet";
import { MailOutlined, EnvironmentOutlined, PhoneOutlined } from '@ant-design/icons';

import "./index.style.less"
const { Text } = Typography;

const Contact = () => {
  return (
    <Layout className={'contact-page-wrapper'}>
      <Helmet title="Contact" />
      <h1>CONTACT</h1>
      <Row gutter={24}>
        <Col span={24}>
          <p>
            For any further questions, suggestions, and feedback, please contact:
          </p>
          <div style={{ marginLeft: 24 }}>
            <p>
              <MailOutlined /> Tin Nguyen (<a href="mailto:tin@wayne.edu">tin@wayne.edu</a>)
            </p>
            <p>
              <EnvironmentOutlined /> Room 2069, Manufacturing Engineering Building (MEB), Wayne State University, 4815 4th St, Detroit, MI 48201
            </p>
            <p>
              <PhoneOutlined /> 313-577-0693
            </p>
          </div>
        </Col>
      </Row>
    </Layout>
  );
};

export default Contact;
