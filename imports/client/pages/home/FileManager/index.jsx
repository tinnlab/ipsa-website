import { Meteor } from "meteor/meteor";
import React from 'react'
import Typography from "antd/lib/typography"
import FileManager from '/imports/client/components/file-manager/react/FileManager'
import FileNavigator from '/imports/client/components/file-manager/react/FileNavigator';
import connectorNodeV1 from '/imports/client/components/file-manager/connector-node-v1';
import Space from "antd/lib/space";
import Helmet from "react-helmet/lib/Helmet";
import Layout from "antd/lib/layout/layout";
import { useTracker } from "meteor/react-meteor-data";
const { Text, Title } = Typography;
import './index.style.less'

export default () => {

    const user = useTracker(() => Meteor.user());
    if (!user) return "Loading ...";

    const isGuest = user.profile.roles.indexOf("guest") !== -1;
    const fileLimit = {
        size: Meteor.settings.public.fileSizeLimit[isGuest ? 'guest' : 'user'],
        number: Meteor.settings.public.fileNumberLimit[isGuest ? 'guest' : 'user'],
    }

    const apiOptions = {
        apiRoot: urlPrefix + `/file-manager-api`
    };

    return (
        <Layout className="file-manager-page-wrapper">
            <Helmet title="File Manager" />
            <Title level={2}>File Manager</Title>

            <Space direction={"vertical"}>
                <Text>
                    File size limit : {fileLimit.size}MB. Maximum number of files
                    : {fileLimit.number} files. Example folder is read-only.
                </Text>
                <Text style={{ display: isGuest ? "block" : "none" }}>
                    Uploaded files from guests will be automatically deleted after 24 hours.
                    Please login to increase file size and upload more file.
                </Text>
            </Space>

            <FileManager className="file-manager">
                <FileNavigator
                    api={connectorNodeV1.api}
                    apiOptions={apiOptions}
                    capabilities={connectorNodeV1.capabilities}
                    listViewLayout={connectorNodeV1.listViewLayout}
                    viewLayoutOptions={connectorNodeV1.viewLayoutOptions}
                />
            </FileManager>
        </Layout>
    )
}
