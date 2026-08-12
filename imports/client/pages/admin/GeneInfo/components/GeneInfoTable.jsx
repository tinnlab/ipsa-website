import React, { useEffect, useState } from 'react';
import Table from "antd/lib/table";
import Space from "antd/lib/space";
import { useTracker } from "meteor/react-meteor-data";
import { Meteor } from "meteor/meteor";
import Form from "antd/lib/form";
import Input from "antd/lib/input";
import Button from "antd/lib/button";

import './GeneInfoTable.style.less'
import useMethod from '/imports/client/hooks/useMethod';

const columns = [
    {
        title: 'Id',
        dataIndex: '_id',
        key: '_id'
    },
    {
        title: 'Tax Id',
        dataIndex: 'taxId',
        key: 'taxId'
    },
    {
        title: 'Symbol',
        dataIndex: 'symbol',
        key: 'symbol'
    },
    {
        title: "Description",
        dataIndex: 'description',
        key: 'description'
    }
]

const FilterForm = ({ query, onFinish }) => {
    const [form] = Form.useForm()

    useEffect(() => {
        form.setFieldsValue(query)
    }, [query])

    return (
        <Form form={form}
            layout={'inline'}
            onFinish={onFinish}
        >
            <Form.Item label={'Tax Id'} name={'taxId'}>
                <Input />
            </Form.Item>
            <Form.Item label={'Symbol'} name={'symbol'}>
                <Input />
            </Form.Item>
            <Form.Item>
                <Button type={"primary"} htmlType={"submit"}>
                    Search
                </Button>
            </Form.Item>
            <Form.Item>
                <Button onClick={() => form.resetFields()}>
                    Clear
                </Button>
            </Form.Item>
        </Form>
    )
}

export default ({ taxId, symbol, externalId }) => {
    const [pagination, setPagination] = useState({
        skip: 0,
        limit: 10
    })
    const [total, setTotal] = useState(0)
    const [subscriptionHandler, setSubscriptionHandler] = useState(undefined)

    const [query, setQuery] = useState({ taxId: taxId, symbol: symbol })

    const { isLoading, error, data } = useMethod('geneInfo.fetch', { ...pagination, ...query }, [pagination, query])

    useEffect(() => {
        (async () => {
            setTotal(
                await Meteor.asyncCallWithNotification("geneInfo.count", query)
            )
        })()
    }, [query])

    if (isLoading) return <div>Loading...</div>
    if (error) return <div>Error</div>


    return (
        <Space direction={'vertical'} style={{ width: '100%' }}>
            <FilterForm query={query} onFinish={setQuery} />
            <Table columns={columns}
                dataSource={data}
                rowKey="_id"
                pagination={{
                    pageSizeOptions: [10, 20, 50, 100],
                    showSizeChanger: true,
                    pageSize: pagination.limit,
                    onChange: (page, limit) => {
                        setPagination({ skip: limit * (page - 1), limit })
                    },
                    current: pagination.skip / pagination.limit + 1,
                    total: total
                }}
            />
        </Space>
    )
}
