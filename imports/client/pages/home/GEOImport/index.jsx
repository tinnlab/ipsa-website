import React, {useState} from 'react'
import Typography from "antd/lib/typography"
import Space from "antd/lib/space";
import Helmet from "react-helmet/lib/Helmet";
import Layout from "antd/lib/layout/layout";
import Form from "antd/lib/form"
import Input from "antd/lib/input"
import Row from "antd/lib/row"
import Alert from "antd/lib/alert"
import Button from "antd/lib/button"
import _ from "lodash"
import Col from "antd/lib/col";
import {Link} from "react-router-dom";

import getGEOData from "/imports/utils/getGEOData";

import SelectFileModal from "/imports/client/components/select-file-modal/SelectFileModal";
import './index.style.less'


const {Title, Paragraph} = Typography

const formLayout = {
    labelCol: {sm: {span: 24}, md: {span: 4}},
    wrapperCol: {sm: {span: 24}, md: {span: 20}}
}

const SelectDirModal = ({onSelectDir, visible}) => {
    return (
        <SelectFileModal
            visible={visible}
            onSelectFile={() => {
            }}
            onCancel={() => onSelectDir(null)}
            capabilities={(apiOptions, actions) => ([
                ({
                    id: 'select-current-folder',
                    icon: {
                        svg: `
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                      <path d="M20.285 2l-11.285 11.567-5.286-5.011-3.714 3.716 9 8.728 15-15.285z"/>
                      </svg>`
                    },
                    label: 'Select current folder',
                    shouldBeAvailable: () => true,
                    availableInContexts: ['toolbar'],
                    handler: () => {
                        let getFullPath = (node) => {
                            let parentIndex = _.findIndex(node.ancestors, {id: node.parentId});
                            if (parentIndex >= 0) {
                                return [...getFullPath(node.ancestors[parentIndex]), node.name];
                            } else return [node.name];
                        };
                        let currentFolder = actions.getResourceLocation()?.slice(-1)[0]
                        if (currentFolder) {
                            let path = getFullPath(currentFolder)
                            onSelectDir(path)
                        }
                    }
                })
            ])}
        />
    )
}

export default () => {

    const [form] = Form.useForm()
    const [geoData, setGeoData] = useState({
        title: undefined,
        samples: [],
        platform: undefined,
        organism: undefined
    })

    const [selectDirModalVisible, setSelectDirModalVisible] = useState(false)

    const [importStatus, setImportStatus] = useState({
        error: false,
        message: "",
        isImporting: false
    })

    global.xForm = form

    const parseGEOData = async () => {

        let id = form.getFieldValue("id");

        if (!id || !id.match(/^GSE[0-9]+/)) {
            setGeoData({})
            return form.setFields([{
                name: 'id',
                value: undefined,
                errors: ['Invalid GEO accession number']
            }]);
        }

        try {
            let data = await getGEOData(id)

            setGeoData(data)
            form.setFields([{
                name: 'id',
                value: id,
                errors: []
            }]);
        } catch (e) {
            setGeoData({})
            return form.setFields([{
                name: 'id',
                value: undefined,
                errors: [e.message]
            }]);
        }
    }

    const importGeo = async (variables) => {
        setImportStatus({
            isImporting: true
        })

        let preview = await Meteor.asyncCallWithNotification("geo.import", {
            ...variables,
            groups: (variables.groups || []).map(g => {
                g.samples = (g.samples || '').split(',').map(e => e.trim()).filter(e => e.length)
                return g
            })
        })

        setImportStatus({
            isImporting: false,
            ...preview
        })
    }

    return (
        <Layout className="import-geo-page-wrapper">
            <Helmet title="Import from NCBI GEO"/>
            <Title level={2}>Import from NCBI GEO</Title>
            <Space direction={"vertical"}>
                <Paragraph>
                    Please see our tutorial for <a href={`${urlPrefix}/tutorial#GEO-import`} target={"__blank"}>Importing
                    data from GEO</a> for detailed information.
                </Paragraph>

                <Form form={form} {...formLayout} initialValues={{path: "Root/"}} onFinish={importGeo}>
                    <Form.Item name={"id"} label={"GEO accession: "}
                               rules={[{required: true, message: "Please input GEO ID"}]}>
                        <Input placeholder={"GSExxxxxx"} onBlur={parseGEOData}/>
                    </Form.Item>
                    <Row style={{display: geoData.title ? "flex" : "none"}}>
                        <Col sm={{span: 24}} md={{span: 4}}/>
                        <Col sm={{span: 24}} md={{span: 20}}>
                            <Space direction={"vertical"} style={{width: "100%"}} size={0}>
                                <Paragraph>
                                    <strong>Title:</strong> {geoData.title}
                                </Paragraph>
                                <Paragraph>
                                    <strong>Organism:</strong> {geoData.organism}
                                </Paragraph>
                                <Paragraph>
                                    <strong>Platform:</strong> {geoData.platform}
                                </Paragraph>
                                <Paragraph>
                                    <strong>Samples:</strong> {geoData.samples?.length} samples
                                </Paragraph>

                                <Space direction={"vertical"} style={{width: "100%"}}>
                                    <Input.TextArea style={{width: "100%"}} value={geoData.samples?.join(', ')}
                                                    rows={4}/>

                                    <Alert type={"warning"}
                                           message={`Warning: Maximum ${Meteor.settings.public.GEOLimit} samples can be imported. Please specify samples to be imported in each group below.`}
                                           style={{display: geoData.samples?.length > Meteor.settings.public.GEOLimit ? "block" : "none"}}
                                    />
                                </Space>
                            </Space>
                        </Col>
                    </Row>
                    <Form.Item label={"Add groups:"} style={{display: geoData.title ? "flex" : "none"}}>
                        <Paragraph>
                            Optional. If no group is assigned to samples, manually selecting samples for analysis is
                            required for each analysis session. Users can also manually create sample annotation file
                            for a dataset. Please see <Link to={`${urlPrefix}/tutorial`}>tutorial</Link> for file
                            format.
                        </Paragraph>

                        <Form.List name="groups">
                            {(fields, {add, remove}) => (
                                <Space direction={"vertical"} style={{width: "100%"}}>
                                    {fields.map(({key, name, fieldKey, ...restField}) => (
                                        <Space key={key} direction={"vertical"} style={{width: "100%"}}>
                                            <Space style={{display: "flex"}} align="start">
                                                <Form.Item label={"Group name"}
                                                           {...restField}
                                                           name={[name, "name"]}
                                                           fieldKey={[fieldKey, 'name']}
                                                           rules={[{
                                                               required: true,
                                                               message: "Please enter group's name"
                                                           }]}
                                                >
                                                    <Input/>
                                                </Form.Item>
                                                <Button onClick={() => remove(name)}>
                                                    Remove
                                                </Button>
                                            </Space>
                                            <Form.Item label={"Samples"}
                                                       {...restField}
                                                       name={[name, "samples"]}
                                                       fieldKey={[fieldKey, 'samples']}
                                                       rules={[
                                                           {required: true, message: "Please enter samples"},
                                                           ({}) => ({
                                                               validator(r, value) {
                                                                   if (value) {
                                                                       let samples = value.split(/[^a-zA-Z0-9]+/).filter(e => e.length)
                                                                       let notFound = samples.filter(e => geoData.samples.indexOf(e) === -1)
                                                                       if (notFound.length) {
                                                                           return Promise.reject(new Error('Samples not found: ' + notFound.join(', ')))
                                                                       }

                                                                       let allSamples = _.uniq(
                                                                           form.getFieldValue("groups").map(e => e.samples.split(/[^a-zA-Z0-9]+/))
                                                                               .flat().filter(e => e.length)
                                                                       )
                                                                       if (allSamples.length > Meteor.settings.public.GEOLimit) {
                                                                           return Promise.reject(new Error(
                                                                               `Totally maximum ${Meteor.settings.public.GEOLimit} samples can be imported`
                                                                           ))
                                                                       }
                                                                   }
                                                                   return Promise.resolve();
                                                               }
                                                           })
                                                       ]}
                                            >
                                                <Input.TextArea rows={4} style={{width: "100%"}}
                                                                placeholder={`GSMxxxxxx, GSMxxxxxx`} onBlur={() => {
                                                    let key = ['groups', fieldKey, "samples"];
                                                    let value = form.getFieldValue(key)
                                                    if (value) {
                                                        form.setFields([{
                                                            name: key,
                                                            errors: form.getFieldError(key),
                                                            value: value.split(/[^a-zA-Z0-9]+/).filter(e => e.length).join(', ')
                                                        }])
                                                    }
                                                }}/>
                                            </Form.Item>
                                        </Space>
                                    ))}
                                    <Form.Item>
                                        <Button type="dashed" onClick={() => add()}>
                                            Add group
                                        </Button>
                                    </Form.Item>
                                </Space>
                            )}
                        </Form.List>

                    </Form.Item>
                    <Form.Item name={"path"} label={"Save to: "}>
                        <Input disabled suffix={(
                            <Button size={"small"} onClick={() => setSelectDirModalVisible(true)}>
                                Browse
                            </Button>
                        )}/>
                    </Form.Item>
                    <Row style={{display: importStatus.message ? 'flex' : 'none', marginBottom: "10px"}}>
                        <Col sm={{span: 24}} md={{span: 4}}/>
                        <Col sm={{span: 24}} md={{span: 20}}>
                            <Alert
                                type={importStatus.error ? "error" : "success"}
                                message={importStatus.message}
                            />
                        </Col>
                    </Row>
                    <Form.Item style={{float: 'right'}}>
                        <Button type="primary" htmlType="submit" loading={importStatus.isImporting}>
                            {importStatus.isImporting ? "Importing" : "Import"}
                        </Button>
                    </Form.Item>
                </Form>
            </Space>
            <SelectDirModal visible={selectDirModalVisible} onSelectDir={(path) => {
                if (path !== null) {
                    form.setFields([{
                        name: "path",
                        value: path.join('/') + '/'
                    }])
                }
                setSelectDirModalVisible(false)
            }}/>
        </Layout>
    )
}
