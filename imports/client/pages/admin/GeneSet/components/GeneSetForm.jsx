import React, {useState} from 'react';
import Form from "antd/lib/form";
import Space from "antd/lib/space";
import Button from "antd/lib/button";
import Select from "antd/lib/select";
import {useTracker} from "meteor/react-meteor-data"
import {sortOrganismsByName} from "/imports/utils/organismSort";

const {Option} = Select

export default ({database}) => {

    const [form] = Form.useForm()
    const [isAdding, setIsAdding] = useState(false)

    const organisms = useTracker(() => {
        Meteor.subscribe('organism.all')
        return sortOrganismsByName(DBCollections.Organism.find().fetch()).map(e => (
            <Option key={e._id} value={e._id}>{e.name + " - Code: " + e.code + " - Tax: " + e.taxId}</Option>)
        )
    })

    const addGeneSet = async (variables) => {
        setIsAdding(true)
        try {
            await Meteor.asyncCallWithNotification('geneSet.add', {
                organismId: variables.organismId,
                databaseId: database._id
            })
            notify.success("Insert Successfully.")
        } catch (e) {
            // do nothing
        }
        setIsAdding(false)
    }

    return (
        <Form form={form}
              labelCol={{span: 4}}
              wrapperCol={{span: 20}}
              onFinish={addGeneSet}
        >
            <Form.Item label="Organism" name={"organismId"} rules={[{required: true}]}>
                <Select showSearch placeholder="select organism" optionFilterProp="children"
                        filterOption={(input, option) =>
                            option.children.toLowerCase().indexOf(input.toLowerCase()) > 0
                        }
                >
                    {organisms}
                </Select>
            </Form.Item>
            <Form.Item wrapperCol={{span: 24}}>
                <Space style={{float: "right"}}>
                    <Button onClick={() => {
                        form.resetFields()
                    }}> Clear </Button>
                    <Button type={"primary"} htmlType={"submit"}
                            loading={isAdding}> {isAdding ? "Saving" : "Save"} </Button>
                </Space>
            </Form.Item>
        </Form>
    )
}
