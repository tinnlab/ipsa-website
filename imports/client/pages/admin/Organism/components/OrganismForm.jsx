import React, {useEffect} from 'react';
import Form from "antd/lib/form";
import Space from "antd/lib/space";
import Input from "antd/lib/input";
import Button from "antd/lib/button";
import InputNumber from "antd/lib/input-number";


export default ({organism = {}}) => {
    const isUpdating = organism._id
    const [form] = Form.useForm()

    const addOrganism = async (variables) => {
        let msg = await Meteor.asyncCallWithNotification('organism.add', variables)
        notify.success(msg || "Insert Successfully.")
    }

    const updateOrganism = async (variables) => {
        let msg = await Meteor.asyncCallWithNotification('organism.update', {
            ...variables,
            _id: organism._id
        })
        notify.success(msg || "Update Successfully.")
    }

    useEffect(() => {
        form.setFieldsValue(organism)
    }, [organism])

    return (
        <Form form={form}
              labelCol={{span: 4}}
              wrapperCol={{span: 20}}
              onFinish={isUpdating ? updateOrganism : addOrganism}
        >
            <Form.Item hidden name={"_id"}>
                <Input disabled/>
            </Form.Item>
            <Form.Item label="Code" name={"code"} rules={[{required: true}]}>
                <Input/>
            </Form.Item>
            <Form.Item label="Name" name={"name"} rules={[{required: true}]}>
                <Input/>
            </Form.Item>
            <Form.Item label="Tax Id" name={"taxId"} rules={[{required: true}]}>
                <InputNumber style={{width: '100%'}}/>
            </Form.Item>
            <Form.Item wrapperCol={{span: 24}}>
                <Space style={{float: "right"}}>
                    <Button onClick={() => {
                        form.resetFields()
                    }}> Clear </Button>
                    <Button style={{display: isUpdating ? "block" : "none"}}
                            onClick={() => form.setFieldsValue(organism)}
                    >
                        Reset
                    </Button>
                    <Button type={"primary"} htmlType={"submit"}> Save </Button>
                </Space>
            </Form.Item>
        </Form>
    )
}
