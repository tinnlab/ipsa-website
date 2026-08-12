import React from 'react';
import Layout from 'antd/lib/layout';

export default (props) => {
    const {Header, Footer, Content} = Layout;

    return (
        <Layout className="admin-layout" style={{textAlign: 'center'}}>
            <Header>
                Header for admin layout
            </Header>
            <Content style={{padding: '0 50px', textAlign: 'center'}}>
                {props.children}
            </Content>
            <Footer style={{textAlign: 'center'}}>
                Footer for admin layout
            </Footer>
        </Layout>
    )
}
