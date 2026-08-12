import React from 'react';
import Table from "antd/lib/table";
import {useTracker} from "meteor/react-meteor-data";

import ColumnSearchProps from "../../../../components/ColumnSearchProps"

export default () => {

    const columns = [
        {title: 'Name', dataIndex: 'name', key: 'name', ...ColumnSearchProps('name')},
        {title: 'Source', dataIndex: 'source', key: 'source', width: '30%', ...ColumnSearchProps('source')},
        {title: 'Description', dataIndex: 'description', key: 'description'},
        {title: 'Version', dataIndex: 'version', key: 'version'}
    ]

    const data = useTracker(() => {
        Meteor.subscribe("idType.all")
        return DBCollections.IDType.find().fetch()
    })

    return (
        <Table columns={columns}
               dataSource={data}
               rowKey="_id"
               pagination={{
                   pageSizeOptions: [10, 20, 50, 100],
                   showSizeChanger: true
               }}
        />
    )
}
