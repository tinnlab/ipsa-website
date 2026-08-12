import React from 'react';
import Form from "antd/lib/form";
import Space from "antd/lib/space";
import Button from "antd/lib/button";
import InputNumber from "antd/lib/input-number";


export default ({database}) => {
    const [form] = Form.useForm()

    const updateVersion = async (variables) => {
        let msg = await Meteor.asyncCallWithNotification('database.update', {
            ...variables,
            ...database
        })
        notify.success(msg || "Database version update successfully.")
    }

    const clearGoCache = async () => {
        await Meteor.asyncCallWithNotification('go.clearCache')
        notify.success("Cache cleared successfully.")
    }

    return (
        <Form form={form}
              labelCol={{span: 4}}
              wrapperCol={{span: 20}}
              onFinish={updateVersion}
        >
            <Form.Item label="Version" name={"version"} rules={[{required: true}]}>
                <InputNumber style={{width: '100%'}}/>
            </Form.Item>
            <Form.Item wrapperCol={{span: 24}}>
                <Space style={{float: "right"}}>
                    <Button style={{display: database.name === "GO" ? "flex" : "none"}} onClick={clearGoCache}> Clear
                        Cache</Button>
                    <Button onClick={() => {
                        form.resetFields()
                    }}> Clear </Button>
                    <Button type={"primary"} htmlType={"submit"}> Save </Button>
                </Space>
            </Form.Item>
        </Form>
    )
}
