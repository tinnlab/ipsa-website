import React, {useState} from 'react';
import Layout from "antd/lib/layout"
import Typography from "antd/lib/typography"
import {Helmet} from "react-helmet";

import Space from "antd/lib/space";
import Collapse from "antd/lib/collapse";

import OrganismTable from "./components/OrganismTable";
import "./index.style.less"
import OrganismForm from "./components/OrganismForm";
import Button from "antd/lib/button";

export default () => {
    const [isAdding, setIsAdding] = useState(false)
    return (
        <Layout className={"org-page-wrapper"}>
            <Helmet title={"Organism"}/>
            <Typography.Title>
                Organism
            </Typography.Title>
            <Space direction={"vertical"} size={"large"}>
                <Collapse>
                    <Collapse.Panel header={<strong>Add new Organism</strong>}>
                        <OrganismForm/>
                    </Collapse.Panel>
                </Collapse>
                <OrganismTable/>
                <Button type={"primary"} loading={isAdding} onClick={async () => {
                    setIsAdding(true)
                    let msg = await Meteor.asyncCallWithNotification('organism.addOrganismsFromReactome')
                    notify.success(msg || "Insert Successfully.")
                    setIsAdding(false)
                }}>
                    Add All
                </Button>
            </Space>
        </Layout>
    )
}
