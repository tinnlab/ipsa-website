import React from 'react';
import Button from "antd/lib/button";
import {useTracker} from "meteor/react-meteor-data";
import Table from "antd/lib/table";
import {Meteor} from "meteor/meteor";
import Collapse from "antd/lib/collapse";
import Space from "antd/lib/space";
import Title from "antd/lib/typography/Title";

import AnnotationDBAddForm from "./AnnotationDBAddForm";
import ColumnSearchProps from "../../../../components/ColumnSearchProps"


export default () => {

    const columns = [
        {title: 'Name', dataIndex: 'name', key: 'name', ...ColumnSearchProps('name')},
        {title: 'Package', dataIndex: 'package', key: 'package', width: '30%', ...ColumnSearchProps('package')},
        {title: 'Version', dataIndex: 'version', key: 'version'},
        {
            title: 'Actions',
            render: (record) => {
                return (
                    <Button onClick={async () => {
                        await Meteor.asyncCallWithNotification('annotationDB.update', {
                            sourcePackage: record.package
                        })
                        notify.success("AnnotationDB is updated.")
                    }}>
                        update
                    </Button>

                )
            }
        }
    ]

    const data = useTracker(() => {
        Meteor.subscribe('annotationDB.fetch')
        return DBCollections.AnnotationDB.find({}).fetch()
    })

    return (
        <Space direction={"vertical"} style={{width: '100%'}}>
            <Title level={3}>Annotation DB</Title>
            <Collapse>
                <Collapse.Panel header={<strong>Add AnnotationDB Source</strong>}>
                    <AnnotationDBAddForm/>
                </Collapse.Panel>
            </Collapse>

            <Table columns={columns}
                   dataSource={data}
                   rowKey="_id"
                   pagination={{
                       pageSizeOptions: [10, 20, 50, 100],
                       showSizeChanger: true
                   }}
            />
        </Space>
    )
}
