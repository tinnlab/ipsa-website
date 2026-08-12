import React, {useEffect, useState} from 'react';
import Layout from "antd/lib/layout"
import Typography from "antd/lib/typography"
import { Helmet } from "react-helmet";
import Space from "antd/lib/space";

import Collapse from "antd/lib/collapse";
import DBUpdateForm from "./components/DBUpdateForm";
import GeneSetTable from "./components/GeneSetTable";

import "./index.style.less"
import Button from "antd/lib/button";
import GeneSetForm from "./components/GeneSetForm";
import { Meteor } from "meteor/meteor";
import { useTracker } from "meteor/react-meteor-data";

export default ({ database }) => {
    const [isAdding, setIsAdding] = useState(false)
    const [filteredOrganisms, setFilteredOrganisms] = useState([])

    useEffect(() => {
        let databaseId = database._id;
        Meteor.asyncCallWithNotification("organism.getFilteredOrganisms", {databaseId}).then((result) => {
            setFilteredOrganisms(result)
        });
    }, [database])

    return (
        <Layout className={"gene-set-page-wrapper"}>
            <Helmet title={database.namespace ? database.name + ": " + database.namespace : database.name} />
            <Typography.Title>
                {database.name}{database?.namespace ? ": " + database.namespace : ""}
            </Typography.Title>
            <Space direction={"vertical"} size={"large"}>
                <Collapse>
                    <Collapse.Panel header={<strong>Update the database version</strong>}>
                        <DBUpdateForm database={database} />
                    </Collapse.Panel>
                    <Collapse.Panel header={<strong>Add new Gene Set</strong>}>
                        <GeneSetForm database={database} />
                    </Collapse.Panel>
                </Collapse>
                <GeneSetTable database={database} />
                <Button type={"primary"} loading={isAdding} onClick={async () => {
                    setIsAdding(true)
                    await Meteor.asyncCallWithNotification("geneSet.addAll", {
                        organismIds: filteredOrganisms.map(e => e._id),
                        databaseId: database._id
                    })
                    setIsAdding(false)
                }}>
                    Add All
                </Button>
            </Space>
        </Layout>
    )
}