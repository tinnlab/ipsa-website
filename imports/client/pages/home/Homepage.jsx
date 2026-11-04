// import React from 'react';
// import {Link} from 'react-router-dom';
//
// import './Homepage.style.less'
//
// const PathwayAnalysisIcon = '/icons/icon-analysis.svg';
// const AIIcon = '/icons/ai-icon.svg';
//
// export default () => (
//     <div className="home-page">
//         <header>
//             <h1>Welcome to IPSA - Intelligent Platform for Systems-level Analysis</h1>
//             <p>Powerful pathway analysis, visualization, meta-analysis, and AI-powered insights tools at your
//                 fingertips.</p>
//         </header>
//
//         <div className="citation-container">
//             <p className="description">
//                 If our platform was beneficial to your research, we would be delighted to be cited in your article.
//                 Please use the following citation:
//             </p>
//             <pre className="citation">
//                 <p>
//                     <cite>Hung Nguyen, Duc Tran, Jonathan M. Galazka, Sylvain V. Costes, Afshin Beheshti, Juli Petereit, Sorin Draghici, and Tin Nguyen. CPA: a web-based platform for consensus pathway analysis and interactive visualization. Nucleic Acids Research, PubMed PMID: 34037798, DOI: 10.1093/nar/gkab421, 2021.</cite>
//                 </p>
//                 <p>
//                     <cite>Hung Nguyen, Ha Nguyen, Zeynab Maghsoudi, Bang Tran, Sorin Draghici, and Tin Nguyen. RCPA: An Open-Source R Package for Data Processing, Differential Analysis, Consensus Pathway Analysis, and Visualization. Current Protocols, PubMed PMID: 38713133, DOI: 10.1002/cpz1.1036, 2024.</cite>
//                 </p>
//                 <p>
//                     <cite>Ha Nguyen, Van-Dung Pham, Hung Nguyen, Bang Tran, Juli Petereit, and Tin Nguyen. CCPA: cloud-based, self-learning modules for consensus pathway analysis using GO, KEGG and Reactome. Briefings in Bioinformatics, PubMed PMID: 38713133, DOI: 10.1093/bib/bbae222, 2024.</cite>
//                 </p>
//             </pre>
//         </div>
//
//         <section className="features">
//             <div className="feature">
//                 <img src={PathwayAnalysisIcon} alt="Pathway Analysis" className="feature-icon"/>
//                 <h2>Pathway Analysis</h2>
//                 <p>Perform differential analysis, pathway analysis (ORA, GSA, GSEA, FGSEA, KS, Wilcoxon, PADOG) using
//                     pathways from KEGG, GO, Reactome, and MitoCarta.</p>
//             </div>
//
//             <div className="feature">
//                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
//                      className="feature-icon">
//                     <path d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/>
//                     <path d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"/>
//                 </svg>
//                 <h2>Results Visualization</h2>
//                 <p>Visualize data and analysis using a variety of charts and graphs (circos plot, heatmap, volcano plot,
//                     Venn diagram, KEGG map, pathway network,...)</p>
//             </div>
//
//             <div className="feature">
//                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
//                      className="feature-icon">
//                     <path d="M2 6h20M2 12h20M2 18h20"/>
//                     <path d="M4 7h2v2H4zm0 5h2v2H4zm0 5h2v2H4z"/>
//                     <path d="M8 7h2v2H8zm0 5h2v2H8zm0 5h2v2H8z"/>
//                     <path d="M12 7h2v2h-2zm0 5h2v2h-2zm0 5h2v2h-2z"/>
//                     <path d="M16 7h2v2h-2zm0 5h2v2h-2zm0 5h2v2h-2z"/>
//                     <path d="M20 7h2v2h-2zm0 5h2v2h-2zm0 5h2v2h-2z"/>
//                 </svg>
//                 <h2>Meta-Analysis</h2>
//                 <p>Combine and analyze data from multiple studies to identify consistent patterns and draw robust
//                     conclusions.</p>
//             </div>
//
//             <div className="feature">
//                 <img src={AIIcon} alt="AI" className="feature-icon"/>
//                 <h2>AI-Powered Insights</h2>
//                 <p>Summarize analyses, interpret results, identify unexpected outcomes, generate new hypotheses.</p>
//             </div>
//         </section>
//
//         <section className="video-tutorial">
//             <h2>Video Tutorial</h2>
//             <p>Watch our comprehensive video guide to learn how to use IPSA effectively:</p>
//             <div className="video-container">
//                 <iframe
//                     width="750"
//                     height="450"
//                     src="https://www.youtube.com/embed/LF7ryDqFVDc"
//                     title="IPSA Tutorial Video"
//                     frameBorder="0"
//                     allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
//                     allowFullScreen
//                 ></iframe>
//             </div>
//         </section>
//
//         <section className="cta-section">
//             <div className="experience-block">
//                 <h4>Experience the power of our platform firsthand:</h4>
//                 <ul>
//                     <li>
//                         <Link to="/analysis/visualization/fzAtXtTLKgQKPfzda">View an example analysis session</Link> to
//                         see the visualization
//                         results and AI-powered insights in action.
//                     </li>
//                     <li>
//                         Check out our <Link to="/tutorial/">Tutorial page</Link> to learn how to perform analyses,
//                         interpret visualizations, and leverage AI-powered features.
//                     </li>
//                 </ul>
//             </div>
//             <div className="cta-block">
//                 <h3 className="cta-heading">Ready to Dive into Your Data?</h3>
//                 <p className="cta-subtitle">Start uncovering valuable insights and patterns with our powerful analysis
//                     tools.</p>
//                 <Link to="/analysis/recent-sessions" className="cta-button">
//                     Begin Your Analysis
//                 </Link>
//             </div>
//         </section>
//     </div>
// )

import React, {useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {
    Button,
    Card,
    Typography,
    Row,
    Col,
    Space,
    Divider,
    Tag,
    Avatar
} from 'antd';
import {
    ExperimentOutlined,
    BarChartOutlined,
    DatabaseOutlined,
    PlayCircleOutlined,
    RocketOutlined,
    BookOutlined,
    EyeOutlined,
    FolderOpenOutlined,
    FileTextOutlined,
    SortAscendingOutlined,
    LineChartOutlined
} from '@ant-design/icons';
import {useTracker} from 'meteor/react-meteor-data';
import {Meteor} from 'meteor/meteor';
import useMethod from '../../hooks/useMethod';
import CaseStudyPicker from './CaseStudyPicker';
import StudySelectionModal from '../../components/StudySelectionModal';
import {resolveVideoTutorial} from '/imports/utils/videoTutorial';

const {Title, Paragraph, Text} = Typography;

const PathwayAnalysisIcon = '/icons/icon-analysis.svg';
const AIIcon = '/icons/ai-icon.svg';

export default () => {
    const navigate = useNavigate();
    const user = useTracker(() => Meteor.user(), []);

    // Which example studies this deployment actually has. The list comes from the server because
    // the mapping lives in Meteor.settings.private (session ids are deployment data), and the
    // method returns only entries whose share row exists and is usable — so a deployment with no
    // case studies configured gets an empty list and the controls below render nothing at all,
    // rather than offering a link that goes nowhere. That is what the two hardcoded
    // /analysis/visualization/<session id> links this replaced used to do: that route is
    // ownership-gated, so every visitor who clicked got an access-denied page.
    const {data: caseStudies, isLoading: caseStudiesLoading} = useMethod('share.caseStudies', undefined, []);
    const [examplePickerOpen, setExamplePickerOpen] = useState(false);
    const [studyModalOpen, setStudyModalOpen] = useState(false);

    // How many studies this visitor already has. A server method rather than a subscription:
    // session.all ships whole Session documents, analyses[] and their per-dataset metadata blobs
    // included, which is a great deal of traffic to render one integer. It counts through the same
    // selector the Recent Studies page filters by, so the number here and the rows there agree.
    const {data: studyCount, isLoading: studyCountLoading} = useMethod('session.myStudyCount', undefined, [user?._id]);
    const recentStudyCount = studyCount || 0;
    // Same rule as showExampleControl: visible while the answer is in flight so the hero does not
    // reflow, gone once we know there is nothing behind it. Guests are auto-created on load, so
    // "logged out" is not really reachable here; a caller with no user counts zero and hides too.
    const showRecentStudiesControl = studyCountLoading || recentStudyCount > 0;

    const examples = caseStudies || [];
    const hasExamples = examples.length > 0;
    // Render the control while the method is still in flight (disabled) so the hero does not reflow
    // once it resolves, but drop it entirely once we know there is nothing to offer.
    const showExampleControl = caseStudiesLoading || hasExamples;

    // The video tutorial demonstrates the previous product and is hidden until a new one is
    // recorded. The switch is Meteor.settings.public.videoTutorial, DEFAULT OFF: showing it again,
    // or pointing it at a different video, is a settings edit rather than a code change. Read once
    // at render — settings do not change under a running client.
    const videoTutorial = resolveVideoTutorial(Meteor.settings.public);

    // Guests are auto-created asynchronously at startup (imports/client/startup.js), so Meteor.user()
    // really is null for the first moments of a cold load. The old guard answered an early click
    // with "Please sign in to try the demo", which is advice no visitor can act on: this app has no
    // sign-in. The cards below are inert until the account exists, and this is the backstop.
    const demoReady = Boolean(user);
    const [creatingDemo, setCreatingDemo] = useState(false);

    const handleDemoClick = async (demoType, demoLabel) => {
        if (!user) {
            notify.info("Preparing your session — please try again in a moment.");
            return;
        }
        // A second click before the first navigation lands would create a second identical study.
        if (creatingDemo) return;

        setCreatingDemo(true);
        try {
            const demoName = `Demo - ${demoLabel}`;
            const {sessionId, activeAnalysis} = await Meteor.asyncCallWithNotification(
                "session.create",
                {
                    userId: user._id,
                    name: demoName,
                    inputType: demoType,
                    // The study and its one analysis carry the same name; the analysis name is what
                    // the tab in the study page shows, and it used to read "Analysis".
                    analysisName: demoName
                }
            );
            navigate(`/analysis/session/${sessionId}/${activeAnalysis}?example=${demoType}`);
        } catch (error) {
            console.error('Error creating demo session:', error);
            notify.error("Failed to create demo session");
        } finally {
            setCreatingDemo(false);
        }
    };

    return (
    <div style={{
        minHeight: '100vh',
        background: `
            linear-gradient(135deg, 
                rgba(16, 80, 98, 0.9) 0%, 
                rgba(26, 108, 122, 0.9) 25%,
                rgba(46, 125, 130, 0.8) 50%,
                rgba(66, 142, 140, 0.9) 75%,
                rgba(86, 160, 155, 0.9) 100%
            ),
            radial-gradient(ellipse at top left, rgba(120, 200, 180, 0.3) 0%, transparent 50%),
            radial-gradient(ellipse at bottom right, rgba(80, 160, 140, 0.3) 0%, transparent 50%),
            radial-gradient(ellipse at center, rgba(60, 140, 120, 0.2) 0%, transparent 70%)
        `,
        position: 'relative',
        overflow: 'hidden'
    }}>
        {/* Animated Background Elements */}
        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.1,
            background: `
                radial-gradient(circle at 20% 20%, rgba(255,255,255,0.3) 1px, transparent 1px),
                radial-gradient(circle at 80% 80%, rgba(255,255,255,0.3) 1px, transparent 1px),
                radial-gradient(circle at 40% 60%, rgba(255,255,255,0.2) 1px, transparent 1px)
            `,
            backgroundSize: '100px 100px, 80px 80px, 120px 120px',
            animation: 'float 20s ease-in-out infinite'
        }}></div>

        {/* Floating geometric shapes */}
        <div style={{
            position: 'absolute',
            top: '10%',
            left: '10%',
            width: '60px',
            height: '60px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '12px',
            animation: 'floatShape 10s ease-in-out infinite',
            transform: 'rotate(45deg)'
        }}></div>

        <div style={{
            position: 'absolute',
            top: '20%',
            right: '5%',
            width: '40px',
            height: '40px',
            background: 'rgba(255,255,255,0.08)',
            borderRadius: '50%',
            animation: 'floatShape 9s ease-in-out infinite reverse'
        }}></div>

        <div style={{
            position: 'absolute',
            top: '5%',
            right: '5%',
            width: '80px',
            height: '80px',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: '16px',
            animation: 'floatShape 8s ease-in-out infinite',
            transform: 'rotate(30deg)'
        }}></div>

        <style>
            {`
            @keyframes float {
                0%, 100% { transform: translateY(0px) rotate(0deg); }
                33% { transform: translateY(-10px) rotate(1deg); }
                66% { transform: translateY(5px) rotate(-1deg); }
            }
            
            @keyframes floatShape {
                0%, 100% { transform: translateY(0px) translateX(0px) rotate(45deg); }
                25% { transform: translateY(-20px) translateX(10px) rotate(50deg); }
                50% { transform: translateY(-10px) translateX(-5px) rotate(40deg); }
                75% { transform: translateY(15px) translateX(8px) rotate(55deg); }
            }
            
            @keyframes blinkBanner {
                0%, 100% { 
                    opacity: 1;
                    box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
                }
                50% { 
                    opacity: 0.8;
                    box-shadow: 0 8px 25px rgba(59, 130, 246, 0.6);
                }
            }
            
            @keyframes blinkText {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
            }
            
            .professional-gradient {
                background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            }

            /* The two "Get Started in Minutes" cards have identical markup — Row align=middle with
               an avatar Col, a flex="auto" text Col and a button Col — but the View Example card
               carries much longer copy. A Col flex="auto" is flex: 1 1 auto, so its hypothetical
               main size is its MAX-CONTENT width; once the three columns together exceed the card,
               antd's default wrap breaks the row and the avatar ends up on a line of its own. Both
               cards were wrapping at desktop width (measured: the View Example card onto three
               lines, the Tutorial card's button onto a second), so the rule is applied to both
               rather than to the one that looked worst.

               Both declarations are needed: nowrap keeps the three columns on one line, and
               min-width:0 lifts the automatic minimum size that would otherwise stop the text
               column shrinking and make the row overflow instead.

               Scoped to >= 992px, which is exactly where the outer Col xs={24} lg={12} makes the
               card half width. Below that the card is full width and antd's default wrap applies,
               because stacking the avatar above the text IS the right answer on a phone. */
            @media (min-width: 992px) {
                .quick-start-row {
                    flex-wrap: nowrap;
                }
                .quick-start-text {
                    min-width: 0;
                }
            }
        `}
        </style>

        {/* Hero Section */}
        <section style={{
            padding: '10px 24px 60px',
            textAlign: 'center',
            color: 'white',
            position: 'relative',
            zIndex: 2
        }}>
            <div style={{maxWidth: '1200px', margin: '0 auto'}}>
                <Title
                    level={1}
                    style={{
                        color: 'white',
                        fontSize: '3.5rem',
                        fontWeight: 700,
                        marginBottom: '24px',
                        textShadow: '0 4px 8px rgba(0,0,0,0.3)',
                        letterSpacing: '2px'
                    }}
                >
                    IPSA
                </Title>
                <Title
                    level={2}
                    style={{
                        color: 'rgba(255,255,255,0.95)',
                        fontWeight: 400,
                        fontSize: '1.8rem',
                        marginBottom: '32px',
                        textShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }}
                >
                    Intelligent Platform for Systems-level Analysis
                </Title>
                <Paragraph
                    style={{
                        fontSize: '1.2rem',
                        color: 'rgba(255,255,255,0.9)',
                        maxWidth: '800px',
                        margin: '0 auto 48px',
                        lineHeight: 1.6,
                        textShadow: '0 1px 2px rgba(0,0,0,0.2)'
                    }}
                >
                    Transform your research with powerful pathway analysis, advanced visualization,
                    comprehensive meta-analysis, consensus analysis, mass analysis and cutting-edge AI-powered insights—all in one integrated platform.
                </Paragraph>
                <Space size="large">
                    {/* Was a second link to /analysis/recent-studies — the same place the counted
                        button beside it now goes. It asks what to start instead, which is what a
                        primary call to action on the homepage should do. */}
                    <Button
                            type="primary"
                            size="large"
                            icon={<RocketOutlined/>}
                            onClick={() => setStudyModalOpen(true)}
                            style={{
                                height: '50px',
                                padding: '0 32px',
                                fontSize: '16px',
                                fontWeight: 600,
                                borderRadius: '25px',
                                background: 'rgba(255,255,255,0.15)',
                                border: '2px solid rgba(255,255,255,0.3)',
                                backdropFilter: 'blur(10px)',
                                boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255,255,255,0.25)';
                                e.currentTarget.style.transform = 'translateY(-3px)';
                                e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
                            }}
                        >
                            Start Your Analysis
                    </Button>
                    {showExampleControl && (
                        <Button
                            size="large"
                            icon={<EyeOutlined/>}
                            disabled={!hasExamples}
                            onClick={() => setExamplePickerOpen(true)}
                            style={{
                                height: '50px',
                                padding: '0 32px',
                                fontSize: '16px',
                                fontWeight: 600,
                                borderRadius: '25px',
                                background: 'transparent',
                                border: '2px solid rgba(255,255,255,0.6)',
                                color: 'white',
                                backdropFilter: 'blur(5px)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                                e.currentTarget.style.transform = 'translateY(-3px)';
                                e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = 'none';
                            }}
                        >
                            View Example
                        </Button>
                    )}
                    {/* Same styling object as View Example beside it, so the hero does not end up
                        with two buttons that look like they belong to different apps. Prefixed:
                        urlPrefix is "" in the shipped settings but is interpolated into every route,
                        so an unprefixed link is a latent bug under a deployment that sets one. */}
                    {showRecentStudiesControl && (
                        <Link to={`${window.urlPrefix || ''}/analysis/recent-studies`}>
                            <Button
                                size="large"
                                icon={<FolderOpenOutlined/>}
                                loading={studyCountLoading}
                                style={{
                                    height: '50px',
                                    padding: '0 32px',
                                    fontSize: '16px',
                                    fontWeight: 600,
                                    borderRadius: '25px',
                                    background: 'transparent',
                                    border: '2px solid rgba(255,255,255,0.6)',
                                    color: 'white',
                                    backdropFilter: 'blur(5px)'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                                    e.currentTarget.style.transform = 'translateY(-3px)';
                                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'transparent';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            >
                                My Recent Studies{recentStudyCount > 0 ? ` (${recentStudyCount})` : ''}
                            </Button>
                        </Link>
                    )}
                </Space>
                <Space>
                    <div style={{maxWidth: '1000px', margin: '0 auto', marginTop: '20px'}}>
                        <div style={{
                            background: 'rgba(255,255,255,0.95)',
                            borderRadius: '16px',
                            padding: '32px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                            backdropFilter: 'blur(10px)',
                            border: '1px solid rgba(255,255,255,0.2)'
                        }}>
                            <div style={{textAlign: 'center', marginBottom: '40px'}}>
                                <Title level={4} style={{marginBottom: '16px', marginTop: 0, color: '#105062'}}>
                                    📚 If our platform contributes to your research, please cite the relevant
                                    publications
                                    below:
                                </Title>
                            </div>
                            <Space direction="vertical" size="large" style={{width: '100%'}}>
                                <Card size="small" style={{
                                    background: 'linear-gradient(135deg, #e3f2fd 0%, #f0f7ff 100%)',
                                    border: '1px solid #bbdefb',
                                    borderRadius: '8px'
                                }}>
                                    <Text style={{fontSize: '14px', lineHeight: 1.6, color: '#1565c0'}}>
                                        <strong>Hung Nguyen, Duc Tran, Jonathan M. Galazka, Sylvain V. Costes, Afshin
                                            Beheshti, Juli Petereit, Sorin Draghici, and Tin Nguyen.</strong> CPA: a
                                        web-based platform for consensus pathway analysis and interactive
                                        visualization. <em>Nucleic Acids Research</em>, PubMed PMID: 34037798, DOI:
                                        10.1093/nar/gkab421, 2021.
                                    </Text>
                                </Card>

                                <Card size="small" style={{
                                    background: 'linear-gradient(135deg, #e8f5e8 0%, #f6ffed 100%)',
                                    border: '1px solid #c8e6c9',
                                    borderRadius: '8px'
                                }}>
                                    <Text style={{fontSize: '14px', lineHeight: 1.6, color: '#2e7d32'}}>
                                        <strong>Hung Nguyen, Ha Nguyen, Zeynab Maghsoudi, Bang Tran, Sorin Draghici, and
                                            Tin Nguyen.</strong> RCPA: An Open-Source R Package for Data Processing,
                                        Differential Analysis, Consensus Pathway Analysis, and Visualization. <em>Current
                                        Protocols</em>, PubMed PMID: 38713133, DOI: 10.1002/cpz1.1036, 2024.
                                    </Text>
                                </Card>

                                <Card size="small" style={{
                                    background: 'linear-gradient(135deg, #fff3e0 0%, #fff7e6 100%)',
                                    border: '1px solid #ffcc80',
                                    borderRadius: '8px'
                                }}>
                                    <Text style={{fontSize: '14px', lineHeight: 1.6, color: '#ef6c00'}}>
                                        <strong>Ha Nguyen, Van-Dung Pham, Hung Nguyen, Bang Tran, Juli Petereit, and Tin
                                            Nguyen.</strong> CCPA: cloud-based, self-learning modules for consensus
                                        pathway analysis using GO, KEGG and Reactome. <em>Briefings in
                                        Bioinformatics</em>, PubMed PMID: 38713133, DOI: 10.1093/bib/bbae222, 2024.
                                    </Text>
                                </Card>
                            </Space>
                        </div>
                    </div>
                </Space>
            </div>
        </section>


        {/* Main Content */}
        <div style={{
            background: 'white',
            minHeight: '100vh',
            borderTopLeftRadius: '40px',
            borderTopRightRadius: '40px',
            marginTop: '-40px',
            position: 'relative',
            zIndex: 1
        }}>
            {/* Features Section */}
            <section style={{padding: '80px 24px 60px', background: 'white'}}>
                <div style={{maxWidth: '1200px', margin: '0 auto'}}>
                    <div style={{textAlign: 'center', marginBottom: '60px'}}>
                        <Title level={2} style={{fontSize: '2.5rem', marginBottom: '16px', color: '#105062'}}>
                            Powerful Features
                        </Title>
                        <Paragraph style={{fontSize: '1.1rem', color: '#666', maxWidth: '600px', margin: '0 auto'}}>
                            Everything you need for comprehensive biological data analysis and interpretation
                        </Paragraph>
                    </div>

                    <Row gutter={[40, 40]} justify="center">
                        <Col xs={24} lg={12}>
                            <Card
                                hoverable
                                style={{
                                    height: '100%',
                                    borderRadius: '20px',
                                    border: 'none',
                                    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                                    transition: 'all 0.4s ease',
                                    background: 'linear-gradient(135deg, #1a6c7a 0%, #105062 100%)',
                                    color: 'white',
                                    display: 'flex',
                                    flexDirection: 'column'
                                }}
                                bodyStyle={{
                                    padding: '48px 32px 32px',
                                    textAlign: 'center',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    height: '100%'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-12px)';
                                    e.currentTarget.style.boxShadow = '0 20px 60px rgba(26, 108, 122, 0.4)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.12)';
                                }}
                            >
                                <Avatar
                                    size={80}
                                    style={{
                                        background: 'rgba(255,255,255,0.2)',
                                        backdropFilter: 'blur(10px)',
                                        border: '2px solid rgba(255,255,255,0.3)',
                                        margin: 'auto',
                                        marginBottom: '32px'
                                    }}
                                    icon={<ExperimentOutlined style={{fontSize: '36px', color: 'white'}}/>}
                                />
                                <Title level={3} style={{color: 'white', marginBottom: '20px', fontSize: '1.8rem'}}>
                                    IPSA's Comprehensive Analysis Suite
                                </Title>
                                <Paragraph style={{
                                    color: 'rgba(255,255,255,0.9)',
                                    lineHeight: 1.7,
                                    fontSize: '1.1rem',
                                    marginBottom: '28px',
                                    flex: 1
                                }}>
                                    Conduct comprehensive bioinformatics analyses including differential expression and pathway enrichment using multiple statistical methods (ORA, Wilcoxon, KS, GSA, FGSEA, PADOG, PGSA) with KEGG, GO, Reactome, and MitoCarta databases.
                                    Visualize results through interactive plots and pathway networks. Perform meta-analysis, consensus analysis, and mass analysis, then leverage AI to automatically interpret your analytical results.
                                </Paragraph>
                                <div style={{marginTop: 'auto'}}>
                                    <Link to="/analysis/recent-studies">
                                        <Button
                                            type="primary"
                                            size="large"
                                            icon={<ExperimentOutlined/>}
                                            style={{
                                                height: '45px',
                                                padding: '0 24px',
                                                fontSize: '15px',
                                                fontWeight: 600,
                                                borderRadius: '22px',
                                                background: 'rgba(255,255,255,0.2)',
                                                border: '2px solid rgba(255,255,255,0.4)',
                                                color: 'white',
                                                backdropFilter: 'blur(10px)',
                                                boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.background = 'rgba(255,255,255,0.3)';
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
                                                e.currentTarget.style.transform = 'translateY(0)';
                                                e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
                                            }}
                                        >
                                            Start Analysis →
                                        </Button>
                                    </Link>
                                </div>
                            </Card>
                        </Col>

                        <Col xs={24} lg={12}>
                            <Card
                                hoverable
                                style={{
                                    height: '100%',
                                    borderRadius: '20px',
                                    border: 'none',
                                    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                                    transition: 'all 0.2s ease-in-out',
                                    background: 'linear-gradient(135deg, #105062 0%, #1a6c7a 100%)',
                                    color: 'white',
                                    display: 'flex',
                                    flexDirection: 'column'
                                }}
                                bodyStyle={{
                                    padding: '48px 32px 32px',
                                    textAlign: 'center',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    height: '100%'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-12px)';
                                    e.currentTarget.style.boxShadow = '0 20px 60px rgba(16, 80, 98, 0.4)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.12)';
                                }}
                            >
                                <Avatar
                                    size={80}
                                    style={{
                                        background: 'rgba(255,255,255,0.2)',
                                        backdropFilter: 'blur(10px)',
                                        border: '2px solid rgba(255,255,255,0.3)',
                                        margin: 'auto',
                                        marginBottom: '32px'
                                    }}
                                    icon={<FileTextOutlined style={{fontSize: '36px', color: 'white'}}/>}
                                />
                                <Title level={3} style={{color: 'white', marginBottom: '20px', fontSize: '1.8rem'}}>
                                    Biological Interpretation & Insights
                                </Title>
                                <Paragraph style={{
                                    color: 'rgba(255,255,255,0.9)',
                                    lineHeight: 1.7,
                                    fontSize: '1.1rem',
                                    marginBottom: '28px',
                                    flex: 1
                                }}>
                                    Turn your analysis results into publication-ready biological insight. Our AI automatically
                                    clusters significant pathways into themes, surfaces hub genes and master regulators,
                                    explains mechanisms grounded in KEGG and Reactome, and generates testable hypotheses —
                                    all exportable as PDF or Word reports.
                                </Paragraph>
                                <div style={{marginTop: 'auto'}}>
                                    <Link to="/ai-interpretation">
                                        <Button
                                            type="primary"
                                            size="large"
                                            icon={<FileTextOutlined/>}
                                            style={{
                                                height: '45px',
                                                padding: '0 24px',
                                                fontSize: '15px',
                                                fontWeight: 600,
                                                borderRadius: '22px',
                                                background: 'rgba(255,255,255,0.2)',
                                                border: '2px solid rgba(255,255,255,0.4)',
                                                color: 'white',
                                                backdropFilter: 'blur(10px)',
                                                boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.background = 'rgba(255,255,255,0.3)';
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
                                                e.currentTarget.style.transform = 'translateY(0)';
                                                e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
                                            }}
                                        >
                                            View Reports →
                                        </Button>
                                    </Link>
                                </div>
                            </Card>
                        </Col>
                    </Row>
                </div>
            </section>

            {/* Demo Examples Section */}
            <section style={{
                padding: '60px 24px',
                background: 'linear-gradient(135deg, #fff9f0 0%, #ffe8cc 100%)'
            }}>
                <div style={{maxWidth: '1200px', margin: '0 auto'}}>
                    <div style={{textAlign: 'center', marginBottom: '48px'}}>
                        <Title level={2} style={{fontSize: '2.5rem', marginBottom: '16px', color: '#105062'}}>
                            Try Demo Examples
                        </Title>
                        <Paragraph style={{fontSize: '1.1rem', color: '#666', maxWidth: '700px', margin: '0 auto'}}>
                            Experience IPSA instantly with pre-loaded example datasets. Click any demo below to create a new analysis session with sample data ready to explore.
                        </Paragraph>
                    </div>

                    <Row gutter={[32, 32]} justify="center">
                        <Col xs={24} md={8}>
                            <Card
                                hoverable
                                style={{
                                    height: '100%',
                                    borderRadius: '16px',
                                    border: 'none',
                                    boxShadow: '0 6px 24px rgba(0,0,0,0.1)',
                                    transition: 'all 0.3s ease',
                                    background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                                    // 'progress' until the auto-created guest account has arrived,
                                    // so the card does not invite a click it would only refuse.
                                    cursor: demoReady ? (creatingDemo ? 'wait' : 'pointer') : 'progress'
                                }}
                                bodyStyle={{
                                    padding: '32px 24px',
                                    textAlign: 'center',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    height: '100%'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-8px)';
                                    e.currentTarget.style.boxShadow = '0 12px 36px rgba(59, 130, 246, 0.25)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.1)';
                                }}
                                onClick={() => handleDemoClick('ora', 'Gene List Analysis')}
                            >
                                <Avatar
                                    size={64}
                                    style={{
                                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                                        margin: 'auto',
                                        marginBottom: '20px'
                                    }}
                                    icon={<FileTextOutlined style={{fontSize: '28px'}}/>}
                                />
                                <Title level={4} style={{marginBottom: '12px', color: '#1e40af'}}>
                                    Gene List Analysis
                                </Title>
                                <Paragraph style={{color: '#666', fontSize: '0.95rem', lineHeight: 1.6, flex: 1}}>
                                    Over-Representation Analysis (ORA) with a curated gene list. Perfect for identifying enriched pathways from differentially expressed genes.
                                </Paragraph>
                                <div style={{marginTop: '16px'}}>
                                    <Tag color="blue">ORA Method</Tag>
                                    <Tag color="cyan">KEGG/GO/Reactome</Tag>
                                </div>
                            </Card>
                        </Col>

                        <Col xs={24} md={8}>
                            <Card
                                hoverable
                                style={{
                                    height: '100%',
                                    borderRadius: '16px',
                                    border: 'none',
                                    boxShadow: '0 6px 24px rgba(0,0,0,0.1)',
                                    transition: 'all 0.3s ease',
                                    background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                                    // 'progress' until the auto-created guest account has arrived,
                                    // so the card does not invite a click it would only refuse.
                                    cursor: demoReady ? (creatingDemo ? 'wait' : 'pointer') : 'progress'
                                }}
                                bodyStyle={{
                                    padding: '32px 24px',
                                    textAlign: 'center',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    height: '100%'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-8px)';
                                    e.currentTarget.style.boxShadow = '0 12px 36px rgba(34, 197, 94, 0.25)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.1)';
                                }}
                                onClick={() => handleDemoClick('pgsea', 'Ranked Gene List with Statistics')}
                            >
                                <Avatar
                                    size={64}
                                    style={{
                                        background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                                        margin: 'auto',
                                        marginBottom: '20px'
                                    }}
                                    icon={<SortAscendingOutlined style={{fontSize: '28px'}}/>}
                                />
                                <Title level={4} style={{marginBottom: '12px', color: '#15803d'}}>
                                    Ranked Gene List with Statistics
                                </Title>
                                <Paragraph style={{color: '#666', fontSize: '0.95rem', lineHeight: 1.6, flex: 1}}>
                                    Parametric Gene Set Enrichment Analysis (PGSEA) on a ranked gene list with statistics (gene, log2 fold change, p-value). Ideal for prioritizing pathways from differential-expression results.
                                </Paragraph>
                                <div style={{marginTop: '16px'}}>
                                    <Tag color="green">PGSEA Method</Tag>
                                    <Tag color="lime">Ranked List with Statistics</Tag>
                                </div>
                            </Card>
                        </Col>

                        <Col xs={24} md={8}>
                            <Card
                                hoverable
                                style={{
                                    height: '100%',
                                    borderRadius: '16px',
                                    border: 'none',
                                    boxShadow: '0 6px 24px rgba(0,0,0,0.1)',
                                    transition: 'all 0.3s ease',
                                    background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                                    // 'progress' until the auto-created guest account has arrived,
                                    // so the card does not invite a click it would only refuse.
                                    cursor: demoReady ? (creatingDemo ? 'wait' : 'pointer') : 'progress'
                                }}
                                bodyStyle={{
                                    padding: '32px 24px',
                                    textAlign: 'center',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    height: '100%'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-8px)';
                                    e.currentTarget.style.boxShadow = '0 12px 36px rgba(234, 179, 8, 0.25)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.1)';
                                }}
                                onClick={() => handleDemoClick('expression', 'Expression Data Analysis')}
                            >
                                <Avatar
                                    size={64}
                                    style={{
                                        background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)',
                                        margin: 'auto',
                                        marginBottom: '20px'
                                    }}
                                    icon={<LineChartOutlined style={{fontSize: '28px'}}/>}
                                />
                                <Title level={4} style={{marginBottom: '12px', color: '#a16207'}}>
                                    Expression Data Analysis
                                </Title>
                                <Paragraph style={{color: '#666', fontSize: '0.95rem', lineHeight: 1.6, flex: 1}}>
                                    Complete workflow from raw expression matrix to pathway insights. Includes differential expression and multiple enrichment methods.
                                </Paragraph>
                                <div style={{marginTop: '16px'}}>
                                    <Tag color="gold">Multiple Methods</Tag>
                                    <Tag color="orange">Full Pipeline</Tag>
                                </div>
                            </Card>
                        </Col>
                    </Row>
                </div>
            </section>

            {/* Video Tutorial Section — off unless Meteor.settings.public.videoTutorial.enabled is
                true AND a youtubeId is set. The shipped video demonstrates the previous product
                (AIPA); it is hidden rather than deleted so that showing it again, or showing a NEW
                video, is a settings edit and not a code change. See imports/utils/videoTutorial.js. */}
            {videoTutorial && (
            <section style={{
                padding: '60px 24px',
                background: 'linear-gradient(135deg, #f8faff 0%, #e8f4f8 100%)'
            }}>
                <div style={{maxWidth: '1200px', margin: '0 auto', textAlign: 'center'}}>
                    <Title level={2} style={{marginBottom: '16px', color: '#105062'}}>
                        <PlayCircleOutlined style={{marginRight: '12px', color: '#1a6c7a'}}/>
                        Video Tutorial
                    </Title>
                    <Paragraph style={{
                        fontSize: '1.1rem',
                        color: '#666',
                        marginBottom: '40px',
                        maxWidth: '600px',
                        margin: '0 auto 40px'
                    }}>
                        Watch our comprehensive video guide to learn how to use IPSA effectively:
                    </Paragraph>

                    <div style={{
                        maxWidth: '800px',
                        margin: '0 auto',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        boxShadow: '0 12px 40px rgba(16, 80, 98, 0.15)',
                        background: 'white',
                        padding: '8px'
                    }}>
                        <iframe
                            width="100%"
                            height="450"
                            src={videoTutorial.embedUrl}
                            title="IPSA Tutorial Video"
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            style={{borderRadius: '12px'}}
                        ></iframe>
                    </div>
                </div>
            </section>
            )}

            {/* Quick Start Section */}
            <section style={{padding: '60px 24px', background: 'white'}}>
                <div style={{maxWidth: '1200px', margin: '0 auto'}}>
                    {/* align="stretch", not the default: align="middle" centred the gradient box at
                        its own content height, leaving it floating in the middle of a taller left
                        column. Dropping the prop is NOT equivalent — antd's default is "top", which
                        would top-align rather than stretch. The box also needs height:100% below,
                        because the Col stretches but its child still sizes to its own content. */}
                    <Row gutter={[40, 40]} align="stretch">
                        <Col xs={24} lg={12}>
                            <Title level={2} style={{marginBottom: '24px', color: '#105062'}}>
                                Get Started in Minutes
                            </Title>
                            <Paragraph
                                style={{fontSize: '1.1rem', color: '#666', marginBottom: '32px', lineHeight: 1.7}}>
                                Experience the power of our platform firsthand with these quick options.
                                Whether you're new to pathway analysis or an experienced researcher,
                                we've got you covered.
                            </Paragraph>

                            <Space direction="vertical" size="large" style={{width: '100%'}}>
                                {showExampleControl && (
                                    <Card style={{borderRadius: '12px', border: '1px solid #e8e8e8'}}>
                                        {/* quick-start-row / quick-start-text: see the @media rule
                                            in the <style> block above. Both cards carry them so the
                                            two cannot drift apart as their copy changes. */}
                                        <Row align="middle" gutter={16} className="quick-start-row">
                                            <Col flex="none">
                                                <Avatar size={48} style={{background: '#52c41a'}} icon={<EyeOutlined/>}/>
                                            </Col>
                                            <Col flex="auto" className="quick-start-text">
                                                <Title level={5} style={{margin: 0, marginBottom: '4px', color: '#105062'}}>View
                                                    Example
                                                    Analysis</Title>
                                                <Paragraph style={{margin: 0, color: '#666'}}>
                                                    Get your own copy of a complete study — visualizations, biological insights
                                                    and the input data, ready to re-run
                                                </Paragraph>
                                            </Col>
                                            <Col flex="none">
                                                <Button
                                                    type="link"
                                                    style={{color: '#1a6c7a'}}
                                                    disabled={!hasExamples}
                                                    onClick={() => setExamplePickerOpen(true)}
                                                >
                                                    Explore →
                                                </Button>
                                            </Col>
                                        </Row>
                                    </Card>
                                )}

                                <Card style={{borderRadius: '12px', border: '1px solid #e8e8e8'}}>
                                    <Row align="middle" gutter={16} className="quick-start-row">
                                        <Col flex="none">
                                            <Avatar size={48} style={{background: '#1890ff'}} icon={<BookOutlined/>}/>
                                        </Col>
                                        <Col flex="auto" className="quick-start-text">
                                            <Title level={5} style={{margin: 0, marginBottom: '4px', color: '#105062'}}>Interactive
                                                Tutorial</Title>
                                            <Paragraph style={{margin: 0, color: '#666'}}>
                                                Step-by-step guidance for performing analyses and interpreting results
                                            </Paragraph>
                                        </Col>
                                        <Col flex="none">
                                            <Link to="/tutorial/">
                                                <Button type="link" style={{color: '#1a6c7a'}}>Learn →</Button>
                                            </Link>
                                        </Col>
                                    </Row>
                                </Card>
                            </Space>
                        </Col>

                        <Col xs={24} lg={12}>
                            {/* height:100% fills the column the Row now stretches (see align above);
                                the flex column then keeps the heading, text and button optically
                                centred instead of stacking them at the top of a taller box. */}
                            <div style={{
                                background: 'linear-gradient(135deg, #105062 0%, #1a6c7a 100%)',
                                borderRadius: '20px',
                                padding: '48px 40px',
                                textAlign: 'center',
                                color: 'white',
                                boxShadow: '0 12px 40px rgba(16, 80, 98, 0.3)',
                                height: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center'
                            }}>
                                <Title level={3} style={{color: 'white', marginBottom: '24px'}}>
                                    Ready to Analyze Your Data?
                                </Title>
                                <Paragraph style={{
                                    color: 'rgba(255,255,255,0.9)',
                                    fontSize: '1.1rem',
                                    marginBottom: '32px',
                                    lineHeight: 1.6
                                }}>
                                    Join thousands of researchers who trust IPSA for their
                                    pathway analysis and data visualization needs.
                                </Paragraph>
                                {/* PR #187 changed the hero's "Start Your Analysis" to open the
                                    study modal; this one was left pointing at the stale destination
                                    the hero used to have, so two buttons with the same label did
                                    two different things. It opens the SAME modal instance mounted
                                    at the bottom of this file — the page already owns the state. */}
                                <Button
                                    type="primary"
                                    size="large"
                                    icon={<RocketOutlined/>}
                                    onClick={() => setStudyModalOpen(true)}
                                    style={{
                                        height: '50px',
                                        padding: '0 32px',
                                        fontSize: '16px',
                                        fontWeight: 600,
                                        borderRadius: '25px',
                                        background: 'white',
                                        color: '#105062',
                                        border: 'none',
                                        boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
                                    }}
                                >
                                    Start Your Analysis
                                </Button>
                            </div>
                        </Col>
                    </Row>
                </div>
            </section>
        </div>

        {/* One modal for both "View Example" controls above — the hero button and the Quick Start
            card open the same picker rather than each owning a copy of it. */}
        <CaseStudyPicker
            open={examplePickerOpen}
            onClose={() => setExamplePickerOpen(false)}
            caseStudies={examples}
        />
        {/* Mounted here for the same reason the picker above is: the hero owns the control that
            opens it. mode="choose" asks single vs mass, which the header's two menu entries answer
            up front and the homepage's single button cannot. */}
        <StudySelectionModal
            visible={studyModalOpen}
            onClose={() => setStudyModalOpen(false)}
            mode="choose"
        />
    </div>
    );
};