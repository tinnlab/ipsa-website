import React from "react";
import {Button, Layout, Result, Typography} from "antd";
import {Helmet} from "react-helmet";
import {useNavigate} from "react-router-dom";

const {Paragraph, Text} = Typography;

// The terminal state for a study the current account cannot open.
//
// ONE message covers both "no such study" and "not yours" on purpose: naming which of the two
// applies would confirm to a stranger which study ids exist. A logged-out or brand-new visitor
// lands here too and must see exactly the same thing — "log in to view" would be a lie, because
// signing in as somebody else still would not grant access. The only route in is a share link,
// which hands over a COPY rather than access to the original.
//
// Owns its Layout/Helmet so each page can drop it in as a single early return; className/style let
// a page keep its own wrapper (analysis-page-wrapper / visualization-page-wrapper).
export default function StudyAccessDenied({className, style}) {
    const navigate = useNavigate();

    return (
        <Layout
            className={className}
            style={style || {padding: 24, minHeight: "calc(100vh - 70px - 60px)"}}
        >
            <Helmet title="Study not available"/>
            <Result
                status="warning"
                title="You don't have access to this study"
                subTitle={
                    <div style={{maxWidth: 560, margin: "0 auto", textAlign: "left"}}>
                        <Paragraph style={{marginBottom: 8}}>
                            Studies are private to the account that created them. This one either
                            does not exist or belongs to someone else.
                        </Paragraph>
                        <Paragraph style={{marginBottom: 0}}>
                            Copying a visualization or session URL out of the address bar does not
                            share a study — the link only works for its owner.
                        </Paragraph>
                    </div>
                }
                extra={
                    <Button
                        type="primary"
                        onClick={() => navigate(`${window.urlPrefix || ""}/analysis/recent-studies`)}
                    >
                        Go to my studies
                    </Button>
                }
            >
                <Text type="secondary">
                    Ask the owner to send you a share link from Recent Studies.
                </Text>
            </Result>
        </Layout>
    );
}
