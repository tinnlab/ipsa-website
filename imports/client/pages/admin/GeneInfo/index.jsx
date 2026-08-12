import React, { useState } from 'react';
import Layout from "antd/lib/layout"
import Typography from "antd/lib/typography"
import { Helmet } from "react-helmet";
import Space from "antd/lib/space";
import Button from "antd/lib/button";
import GeneInfoTable from "./components/GeneInfoTable";
import useSubscription from '/imports/client/hooks/useSubscription';
import AnnotationDBTable from "./components/AnnotationDBTable";
import { useTracker } from "meteor/react-meteor-data";

import "./index.style.less"

export default () => {

    const [isUpdatingGene, setIsUpdatingGene] = useState(false)
    const [isUpdatingEntrezIdMapping, setIsUpdatingEntrezIdMapping] = useState(false)

    useSubscription('idMapping.import.logs', {}, []);

    const isUpdatingUniProt = useTracker(() => {

        let isUnlock = DBCollections.IDMappingLogs.findOne({ type: "unlock" });

        if (isUnlock) return false;
        let lockRecord = DBCollections.IDMappingLogs.findOne({ type: "lock" }, { sort: { time: -1 } });

        if (lockRecord) {
            return new Date(lockRecord.time).getTime() > Date.now() - 1000 * 60 * 5
        }
        return false;
    })


    return (
        <Layout className={"gene-info-page-wrapper"}>
            <Helmet title={'Gene Info'} />
            <Typography.Title>
                Gene Info
            </Typography.Title>
            <Space direction={"vertical"} size={"large"}>
                <Space direction={"horizontal"}>
                    <Button type={"primary"} loading={isUpdatingGene} onClick={async () => {
                        setIsUpdatingGene(true)
                        try {
                            await Meteor.asyncCallWithNotification('geneInfo.update')
                            notify.success("Gene Info is update successfully.")
                        } catch (e) {
                        }
                        setIsUpdatingGene(false)
                    }}> {isUpdatingGene ? "Updating" : "Update"} Gene Info</Button>

                    <Button type={"primary"} loading={isUpdatingUniProt} onClick={() => {
                        Meteor.asyncCallWithNotification('idMapping.uniprot.update')
                    }}>{isUpdatingUniProt ? "Updating" : "Update"} UniProt</Button>

                    <Button type={"primary"} disabled={isUpdatingUniProt} onClick={async () => {
                        setIsUpdatingEntrezIdMapping(true)
                        try {
                            await Meteor.asyncCallWithNotification('idMapping.entrezID.update')
                            notify.success("Entrez ID Mapping is update successfully.")
                        } catch (e) {
                        }
                        setIsUpdatingEntrezIdMapping(false)
                    }}>{isUpdatingEntrezIdMapping ? "Updating" : "Update"} EntrezIDMapping from UniProt</Button>
                </Space>
                <GeneInfoTable />
                <AnnotationDBTable />
            </Space>
        </Layout>
    )
}
