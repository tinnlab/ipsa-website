import React, {useState} from 'react';
import Form from "antd/lib/form";
import Space from "antd/lib/space";
import Button from "antd/lib/button";
import Input from "antd/lib/input";


export default () => {

    const [form] = Form.useForm()
    const [isAdding, setIsAdding] = useState(false)

    const addAnnotationDB = async (variables) => {
        setIsAdding(true)
        try {
            await Meteor.asyncCallWithNotification('annotationDB.add', {
                ...variables
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
              onFinish={addAnnotationDB}
        >
            <Form.Item label="Package" name={"sourcePackage"} rules={[{required: true}]}>
                <Input/>
            </Form.Item>
            <Form.Item label="Name" name={"name"} rules={[{required: true}]}>
                <Input/>
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
