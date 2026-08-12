import React from 'react';
import Table from "antd/lib/table";
import Space from "antd/lib/space";
import Popconfirm from "antd/lib/popconfirm";
import Button from "antd/lib/button";
import {useTracker} from "meteor/react-meteor-data"
import Typography from "antd/lib/typography";
import AddOrg from "./OrganismForm";
import ColumnSearchProps from "../../../../components/ColumnSearchProps"
import {sortOrganismsByName} from "/imports/utils/organismSort";

const {Title} = Typography

const expandedRowRender = (organism) => {
    return (
        <>
            <Title level={3}>
                {organism.name}
            </Title>
            <AddOrg organism={organism}/>
        </>
    )
}

export default () => {

    const columns = [
        {title: 'Code', dataIndex: 'code', key: 'code', width: '20%', ...ColumnSearchProps('code')},
        {title: 'Name', dataIndex: 'name', key: 'name', width: '30%', ...ColumnSearchProps('name')},
        {title: 'Tax ID', dataIndex: 'taxId', key: 'taxId', width: '20%', ...ColumnSearchProps('taxId')},
        {
            title: 'Enabled',
            render: (record) => record.isEnabled ? "Yes" : "No"
        },
        {
            title: 'Actions',
            render: ({_id, isEnabled}) => {
                return (
                    <Space>
                        <Popconfirm
                            title="Are you sure?"
                            onConfirm={async () => {
                                await Meteor.asyncCallWithNotification('organism.remove', _id)
                                notify.success("Organism is removed.")
                            }}
                            okText="Yes"
                            cancelText="No"
                        >
                            <Button>
                                Delete
                            </Button>
                        </Popconfirm>
                        <Button onClick={() => {
                            Meteor.asyncCallWithNotification('organism.enable', {_id, isEnabled: !isEnabled})
                        }}>
                            {isEnabled ? 'Disable' : 'Enable'}
                        </Button>
                    </Space>
                )
            }
        }
    ]

    const data = useTracker(() => {
        Meteor.subscribe("organism.all")
        return sortOrganismsByName(DBCollections.Organism.find().fetch())
    })

    return (
        <Table columns={columns}
               dataSource={data}
               expandable={{expandedRowRender}}
               rowKey="_id"
               pagination={{
                   pageSizeOptions: [10, 20, 50, 100],
                   showSizeChanger: true
               }}
        />
    )
}
