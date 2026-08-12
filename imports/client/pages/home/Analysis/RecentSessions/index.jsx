import React, {useEffect, useState, useMemo, useCallback} from "react";
import Layout from "antd/lib/layout";
import {Helmet} from "react-helmet";
import Typography from "antd/lib/typography";
import Space from "antd/lib/space";
import Table from "antd/lib/table";
import {useTracker} from "meteor/react-meteor-data";
import {Meteor} from "meteor/meteor";
import moment from "moment";
import Button from "antd/lib/button";
import Form from "antd/lib/form";
import Input from "antd/lib/input";
import Popconfirm from "antd/lib/popconfirm";
import {Link, useNavigate} from "react-router-dom";
import Modal from "antd/lib/modal";
import Alert from "antd/lib/alert";
import Dropdown from "antd/lib/dropdown";
import {DownOutlined} from "@ant-design/icons";
import WorkspaceModal from "./WorkspaceModal";
import ShareModal from "./ShareModal";
import {isSessionExpired, formatDaysLeft} from "../../../../../utils/retention";

import "./index.style.less";

const {Title, Text} = Typography;

export default () => {
    const navigate = useNavigate();
    const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
    // The study whose share links are being managed, or null. A state setter is stable, so the
    // columns useMemo below can close over it despite its empty dependency array.
    const [shareRecord, setShareRecord] = useState(null);
    const [createSessionForm] = Form.useForm();

    const user = useTracker(() => Meteor.user());
    const data = useTracker(() => {
        const currentUser = Meteor.user();
        if (!currentUser) return [];
        return DBCollections.Session.find(
            {userId: currentUser._id},
            {sort: {createdAt: -1}}
        ).fetch();
    }, []);

    useEffect(() => {
        if (user) {
            Meteor.subscribe("session.all", user._id);
        }
    }, [user]);

    const columns = useMemo(() => [
        {
            title: "Study Name",
            dataIndex: "name",
            key: "name",
            sorter: (a, b) => a.name.localeCompare(b.name),
            sortDirections: ['ascend', 'descend', 'ascend'],
        },
        {
            title: "Created At",
            dataIndex: "createdAt",
            key: "createdAt",
            sorter: (a, b) => a.createdAt - b.createdAt,
            sortDirections: ['ascend', 'descend', 'ascend'],
            render: (createdAt) => moment(createdAt).format("YYYY-MM-DD HH:mm:ss"),
        },
        {
            title: "Expires In",
            dataIndex: "expiredIn",
            key: "expiredIn",
            render: (_, record) => {
                const expiredAt = moment(record.expiredAt);
                const currentTime = moment();

                // Expiry is driven solely by expiredAt (the same signal the server sweep uses),
                // not the never-set status field.
                const isExpired = isSessionExpired({ expiredAt: record.expiredAt, nowMs: Date.now() });
                const isExpiringSoon = expiredAt.diff(currentTime, "days") < 5;
                const expiredInStyle = isExpiringSoon ? {color: "red"} : {};

                return isExpired ? (
                    ""
                ) : (
                    // formatDaysLeft shows the day count alone — over a 90-day window the hours and
                    // minutes were noise on every row — and only drops to hours, then minutes, once
                    // the study is inside its last day. It counts TOTAL days (moment.duration().days()
                    // returns only the sub-month component, which wraps as the span passes a month).
                    <span style={expiredInStyle}>
                        {formatDaysLeft(expiredAt.diff(currentTime))}
                    </span>
                );
            },
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            // Reflect the actual expiry signal (same as the sweep) rather than the stored
            // status, which is only ever "Active" and would mislabel an expired study.
            render: (status, record) => {
                if (isSessionExpired({ expiredAt: record.expiredAt, nowMs: Date.now() })) return "Expired";
                // A study imported in "results only" mode cannot be edited or re-run, so say so
                // here rather than letting it look like an ordinary study.
                if (record.readOnly) return "(View only)";
                return status || "Active";
            },
        },
        {
            title: "Actions",
            key: "actions",
            render: (_, record) => {
                const isExpired = isSessionExpired({ expiredAt: record.expiredAt, nowMs: Date.now() });
                // A view-only import has no uploaded inputs and rejects every write, so Edit and
                // Share are omitted: Edit leads to a wizard that cannot save, and re-sharing a copy
                // would hand on a study the sharer does not own the inputs for.
                const isReadOnly = Boolean(record.readOnly);
                return (
                    <Space>
                        {!isReadOnly && (
                            <Button size={"small"} disabled={isExpired}>
                                <Link
                                    to={`${urlPrefix}/analysis/session/${record._id}/${record.activeAnalysis}`}
                                    disabled={isExpired}
                                >
                                    Edit
                                </Link>
                            </Button>
                        )}
                        <Button size={"small"} disabled={isExpired}>
                            <Link to={`${urlPrefix}/analysis/visualization/${record._id}`} disabled={isExpired}>
                                Visualize
                            </Link>
                        </Button>
                        {!isReadOnly && (
                            <Button
                                size={"small"}
                                disabled={isExpired}
                                onClick={() => setShareRecord(record)}
                            >
                                Share
                            </Button>
                        )}
                        <Popconfirm
                            title="Are you sure?"
                            onConfirm={async () => {
                                const res = await Meteor.asyncCallWithNotification("session.remove", record._id);
                                // Only claim success when a study was actually removed (it may have
                                // already been swept/removed → {removed:false}).
                                if (res && res.removed) notify.success("Study is removed.");
                            }}
                            okText="Yes"
                            cancelText="No"
                            disabled={isExpired}
                        >
                            <Button size={"small"} disabled={isExpired}>
                                Remove
                            </Button>
                        </Popconfirm>
                        <Button
                            size={"small"}
                            onClick={async () => {
                                // Server computes the new expiry (adds the configured retention
                                // window to the current expiredAt) and enforces ownership — don't
                                // send a date. asyncCallWithNotification surfaces any error toast
                                // (matches the sibling Remove handler); the window is operator-
                                // configurable, so the toast stays generic rather than drift.
                                await Meteor.asyncCallWithNotification("session.extendExpiration", record._id);
                                notify.success("Study expiration extended.");
                            }}
                            // Intentionally NOT disabled when expired: a study lingers until the
                            // nightly sweep, so Extend must stay available to rescue it in time.
                        >
                            Extend
                        </Button>
                    </Space>
                );
            },
        },
    ], []); // Empty dependency array means this will only be calculated once

    // Both menu options create the study the same way — the only difference is where they land, so
    // the study name is collected once by the form above rather than in two separate flows. This
    // mirrors the header's "Create Analysis" / "Create Mass Analysis" entries, which also both call
    // session.create and differ only in their destination (StudySelectionModal.jsx).
    const handleCreateStudy = useCallback(async (mode) => {
        let values;
        try {
            // Runs the same required-name rule the form's own submit does; rejects (and stops here)
            // when the field is empty, leaving the error message on the field.
            values = await createSessionForm.validateFields();
        } catch (validationError) {
            return;
        }
        try {
            const {sessionId, activeAnalysis} = await Meteor.asyncCallWithNotification(
                "session.create",
                {
                    userId: user?._id,
                    name: values.name
                }
            );
            createSessionForm.resetFields();
            navigate(mode === "massAnalysis"
                ? `${urlPrefix}/analysis/mass-analysis/${sessionId}`
                : `${urlPrefix}/analysis/session/${sessionId}/${activeAnalysis}`);
        } catch (createError) {
            // asyncCallWithNotification has already toasted the reason and rethrown; swallow it here
            // so the failure does not surface as an unhandled rejection.
        }
    }, [user, navigate, createSessionForm]);

    const createStudyMenu = useMemo(() => ({
        items: [
            {key: "createAnalysis", label: "Create Analysis"},
            {key: "massAnalysis", label: "Create Mass Analysis"},
        ],
        onClick: ({key}) => handleCreateStudy(key),
    }), [handleCreateStudy]);

    if (!user) return <div style={{ padding: 24 }}>Loading ...</div>;

    return (
        <Layout className="recent-sessions-page-wrapper">
            <Helmet title={"Recent Studies"}/>
            <Space direction={"vertical"} style={{ width: '100%' }}>
                <Alert
                    message="Workspace Management"
                    description={
                        <Space direction="vertical" size="small">
                            <Text>Save your workspace to recover all studies later, or retrieve a previously saved workspace.</Text>
                            <Space>
                                <Button
                                    type="link"
                                    onClick={() => setIsWorkspaceModalOpen(true)}
                                    style={{ paddingLeft: 0 }}
                                >
                                    Save or recover workspace →
                                </Button>
                            </Space>
                        </Space>
                    }
                    type="info"
                    showIcon
                    closable
                    style={{ marginBottom: 16 }}
                />

                <Title level={3}>Create New Study</Title>
                <Form
                    form={createSessionForm}
                    layout={"vertical"}
                    // Pressing Enter in the name field keeps doing what it always did: a plain
                    // single-analysis study. Only the menu can choose the mass-analysis destination.
                    onFinish={() => handleCreateStudy("createAnalysis")}
                >
                    <Form.Item
                        label="Study Name"
                        name="name"
                        rules={[{required: true, message: "Please input study name!"}]}
                    >
                        <Input placeholder="Enter a name for your study" />
                    </Form.Item>

                    <Form.Item>
                        {/* Not htmlType="submit": the menu decides where the new study opens, so the
                            trigger must open the menu rather than submit the form behind it. */}
                        <Dropdown menu={createStudyMenu} trigger={["click"]}>
                            <Button type="primary">
                                Create Study <DownOutlined/>
                            </Button>
                        </Dropdown>
                    </Form.Item>
                </Form>
                <Title level={3}>Recent Studies</Title>
                <Table
                    columns={columns}
                    dataSource={data}
                    rowKey="_id"
                    pagination={{pageSize: 10}}
                    rowClassName={(record) => (isSessionExpired({ expiredAt: record.expiredAt, nowMs: Date.now() }) ? "expired-row" : "")}
                />
            </Space>

            <WorkspaceModal
                visible={isWorkspaceModalOpen}
                onClose={() => setIsWorkspaceModalOpen(false)}
                onSuccess={() => {
                    setIsWorkspaceModalOpen(false);
                }}
            />

            {/* Keyed so the modal unmounts on close: creating a link writes StudyShare, not
                Session, so the row object's identity never changes and a reset keyed on the study
                would not fire when the SAME study is reopened — leaving the previous selection and
                "link ready" alert on screen. */}
            {shareRecord && (
                <ShareModal
                    key={shareRecord._id}
                    study={shareRecord}
                    onClose={() => setShareRecord(null)}
                />
            )}
        </Layout>
    );
};