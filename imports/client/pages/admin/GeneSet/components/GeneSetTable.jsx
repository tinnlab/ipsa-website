import React, {useState} from 'react';
import Table from "antd/lib/table";
import Space from "antd/lib/space";
import Popconfirm from "antd/lib/popconfirm";
import Button from "antd/lib/button";
import {useTracker} from "meteor/react-meteor-data";
import _ from "lodash";
import {Meteor} from "meteor/meteor";
import ColumnSearchProps from "../../../../components/ColumnSearchProps"

export default ({database}) => {

    const [selectedAggregateGeneSetIds, setSelectedAggregateGeneSetIds] = useState([])
    const [isUpdating, setIsUpdating] = useState(false)

    const data = useTracker(() => {
        Meteor.subscribe("geneSet.aggregation.all", {databaseId: database._id})
        Meteor.subscribe("organism.all")
        return DBCollections.GeneSetAggregation.find().fetch().map(e => ({
            ...e,
            organism: DBCollections.Organism.findOne(e.organism) || {}
        }))
    })

    const batchUpdate = async () => {
        setIsUpdating(true)
        try {
            let organismIds = DBCollections.GeneSetAggregation.find({
                _id: {$in: selectedAggregateGeneSetIds}
            }).fetch().map(e => e.organism)

            await Meteor.asyncCallWithNotification("geneSet.batchUpdate", {
                organismIds: organismIds,
                databaseId: database._id
            })
            notify.success("Successfully updated.")
        } catch (e) {
            // do nothing
        }
        setIsUpdating(false)
    }

    const columns = [
        {
            title: 'Tax Id',
            width: '20%',
            dataIndex: ['organism', 'taxId'],
            ...ColumnSearchProps(['organism', 'taxId'])
        },
        {
            title: 'KEGG Code',
            dataIndex: ['organism', 'code'],
            width: '20%',
            ...ColumnSearchProps(['organism', 'code'])
        },
        {
            title: '# Gene Set',
            dataIndex: 'count',
            key: 'count',
            width: '20%',
            ...ColumnSearchProps('count')
        },
        {
            title: 'Actions',
            render: (record) => {
                return (
                    <Space>
                        <Button onClick={async () => {
                            await Meteor.asyncCallWithNotification('geneSet.update', {
                                organismId: record.organism._id,
                                databaseId: record.database
                            })
                            notify.success("Gene Set is updated.")
                        }}>
                            update
                        </Button>
                        <Popconfirm
                            title="Are you sure?"
                            onConfirm={async () => {
                                await Meteor.asyncCallWithNotification('geneSet.remove', {
                                        organismId: record.organism._id,
                                        databaseId: record.database
                                    }
                                )
                                notify.success("Gene Set is removed.")
                            }}
                            okText="Yes"
                            cancelText="No"
                        >
                            <Button>
                                Remove
                            </Button>
                        </Popconfirm>
                    </Space>
                )
            }
        }
    ]

    return (
        <Space direction={'vertical'} style={{width: '100%'}}>
            <Button disabled={!selectedAggregateGeneSetIds.length} type={"primary"} loading={isUpdating}
                    onClick={batchUpdate}>
                {isUpdating ? "Updating" : "Update"} Selected
            </Button>

            <Table columns={columns}
                   dataSource={data}
                   rowKey="_id"
                   pagination={{
                       pageSizeOptions: [10, 20, 50, 100],
                       showSizeChanger: true
                   }}
                   rowSelection={{
                       selectedRowKeys: selectedAggregateGeneSetIds,
                       onChange(ids) {
                           let idInCurrentPage = data.map(e => e._id)
                           let removedIds = selectedAggregateGeneSetIds
                               .filter(id => ids.indexOf(id) === -1)
                               .filter(id => idInCurrentPage.indexOf(id) !== -1)

                           ids = _.uniq(ids.concat(selectedAggregateGeneSetIds)).filter(id => removedIds.indexOf(id) === -1)
                           setSelectedAggregateGeneSetIds(ids)
                       }
                   }}
            />
        </Space>
    )
}
