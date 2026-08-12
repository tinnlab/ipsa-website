import React from 'react';
import Layout from "antd/lib/layout"
import Typography from "antd/lib/typography"
import {Helmet} from "react-helmet";

import Space from "antd/lib/space";
import Collapse from "antd/lib/collapse";

import "./index.style.less"
import IdTypeTable from "./components/IdTypeTable";

export default () => {
    return (
        <Layout className={"id-type-page-wrapper"}>
            <Helmet title={"ID Type"}/>
            <Typography.Title>
                ID Type
            </Typography.Title>
            <Space direction={"vertical"} size={"large"}>
                <IdTypeTable/>
            </Space>
        </Layout>
    )
}
