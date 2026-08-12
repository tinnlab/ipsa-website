// import React, { useEffect, useCallback, useRef } from 'react';
// import { Widget, addResponseMessage, deleteMessages } from '@ryaneewx/react-chat-widget';
// import { Meteor } from 'meteor/meteor';
// import '@ryaneewx/react-chat-widget/lib/styles.css';
// import "./index.less"
//
// const ChatWidget = () => {
//   const responseMessageId = useRef(null);
//
//   useEffect(() => {
//     addResponseMessage('Welcome to IPSA\'s chat! How can I help you today?');
//   }, []);
//
//   const updateResponseMessage = (content) => {
//     if (responseMessageId.current !== null && content !== "Processing your request...") {
//       deleteMessages(1, responseMessageId.current);
//     }
//     responseMessageId.current = addResponseMessage(content);
//   };
//
//   const handleNewUserMessage = useCallback(async (newMessage) => {
//     console.log(`New message incoming! ${newMessage}`);
//
//     try {
//       updateResponseMessage("Processing your request...");
//
//       // Call Meteor method
//       const response = await new Promise((resolve, reject) => {
//         Meteor.call('chat.processMessage', newMessage, (error, result) => {
//           if (error) {
//             reject(error);
//           } else {
//             resolve(result);
//           }
//         });
//       });
//
//       updateResponseMessage(response);
//
//     } catch (error) {
//       console.error('Error processing message:', error);
//       updateResponseMessage("I'm sorry, I couldn't process your request. Please try again later.");
//     }
//   }, []);
//
//   return (
//     <Widget
//       handleNewUserMessage={handleNewUserMessage}
//       title="IPSA Chatbot"
//       subtitle="How can we help you today?"
//       senderPlaceHolder="Type a message..."
//       showCloseButton={true}
//       fullScreenMode={false}
//       emojis={false}
//     />
//   );
// };
//
// export default ChatWidget;

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Layout,
  Button,
  Card,
  Input,
  Space,
  Avatar,
  Typography,
  Divider,
  Spin
} from 'antd';
import {
  MessageOutlined,
  SendOutlined,
  ExpandAltOutlined,
  CompressOutlined,
  CloseOutlined,
  RobotOutlined,
  UserOutlined
} from '@ant-design/icons';
import { Meteor } from 'meteor/meteor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const { Content } = Layout;
const { Text, Paragraph } = Typography;
const { TextArea } = Input;

// Compact markdown styling so bot replies render cleanly inside the chat bubble.
const chatMarkdownComponents = {
  p: ({ node, ...props }) => <p style={{ margin: '0 0 6px' }} {...props} />,
  ul: ({ node, ...props }) => <ul style={{ margin: '0 0 6px', paddingLeft: 18 }} {...props} />,
  ol: ({ node, ...props }) => <ol style={{ margin: '0 0 6px', paddingLeft: 18 }} {...props} />,
  li: ({ node, ...props }) => <li style={{ marginBottom: 2 }} {...props} />,
  a: ({ node, ...props }) => <a style={{ color: '#105062' }} target="_blank" rel="noopener noreferrer" {...props} />,
  h1: ({ node, ...props }) => <h4 style={{ margin: '4px 0', fontSize: 15 }} {...props} />,
  h2: ({ node, ...props }) => <h4 style={{ margin: '4px 0', fontSize: 15 }} {...props} />,
  h3: ({ node, ...props }) => <h5 style={{ margin: '4px 0', fontSize: 14 }} {...props} />,
  code: ({ node, inline, ...props }) =>
    inline ? (
      <code style={{ background: '#f0f0f0', padding: '1px 4px', borderRadius: 4, fontSize: 13 }} {...props} />
    ) : (
      <code style={{ display: 'block', background: '#f6f6f6', padding: 8, borderRadius: 6, overflowX: 'auto', fontSize: 13 }} {...props} />
    ),
  table: ({ node, ...props }) => <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }} {...props} />,
  th: ({ node, ...props }) => <th style={{ border: '1px solid #e8e8e8', padding: '4px 6px', textAlign: 'left' }} {...props} />,
  td: ({ node, ...props }) => <td style={{ border: '1px solid #e8e8e8', padding: '4px 6px' }} {...props} />,
};

const ChatSidePanel = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSpeechBubble, setShowSpeechBubble] = useState(false);
  const [currentMessage, setCurrentMessage] = useState('');
  const messagesEndRef = useRef(null);

  // Chat panel widths
  const collapsedWidth = 350;
  const expandedWidth = 500;
  const currentWidth = isExpanded ? expandedWidth : collapsedWidth;

  // Speech bubble messages
  const speechMessages = [
    "Need research help?",
    "Ask me anything!",
    "Pathway analysis questions?",
    "I'm here to help! 🤖"
  ];

  // Speech bubble animation effect
  useEffect(() => {
    if (!isOpen) {
      let bubbleTimeout;
      let messageIndex = 0;

      const showNextBubble = () => {
        // Set the current message
        setCurrentMessage(speechMessages[messageIndex]);
        setShowSpeechBubble(true);

        // Hide bubble after 4 seconds (increased from 3)
        setTimeout(() => {
          setShowSpeechBubble(false);

          // Move to next message
          messageIndex = (messageIndex + 1) % speechMessages.length;

          // Show next bubble after 2 seconds fade out (increased from 1)
          bubbleTimeout = setTimeout(showNextBubble, 2000);
        }, 4000);
      };

      // Show first bubble after 1 second when page loads (increased from 0.5)
      const initialTimer = setTimeout(showNextBubble, 1000);

      return () => {
        clearTimeout(initialTimer);
        clearTimeout(bubbleTimeout);
      };
    } else {
      // Hide bubble when chat is open
      setShowSpeechBubble(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{
        id: Date.now(),
        type: 'bot',
        content: "Welcome to IPSA's chat! How can I help you today?",
        timestamp: new Date()
      }]);
    }
  }, [isOpen]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: inputValue.trim(),
      timestamp: new Date()
    };

    // Build recent conversation history (prior turns only; the new message is sent separately).
    // `messages` here still holds the turns before this one, since setMessages is async.
    const history = messages
      .filter(m => m.type === 'user' || m.type === 'bot')
      .slice(-10)
      .map(m => ({ role: m.type === 'bot' ? 'assistant' : 'user', content: m.content }));

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // Call Meteor method
      const response = await new Promise((resolve, reject) => {
        Meteor.call('chat.processMessage', userMessage.content, history, (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        });
      });

      const botMessage = {
        id: Date.now() + 1,
        type: 'bot',
        content: response,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      console.error('Error processing message:', error);
      const errorMessage = {
        id: Date.now() + 1,
        type: 'bot',
        content: "I'm sorry, I couldn't process your request. Please try again later.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, messages]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (timestamp) => {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const toggleChat = () => {
    setIsOpen(!isOpen);
    if (isExpanded && !isOpen) {
      setIsExpanded(false);
    }
  };

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <Layout style={{ height: '100vh' }}>
      {/* Main Content Area */}
      <Content
        style={{
          marginRight: isOpen ? `${currentWidth}px` : '0px',
          transition: 'margin-right 0.3s ease',
          overflow: 'auto'
        }}
      >
        {children}
      </Content>

      {/* Floating Assistant Avatar (when closed) */}
      {!isOpen && (
        <div
          style={{
            position: 'fixed',
            right: '20px',
            bottom: '20px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '12px'
          }}
        >
          {/* Speech Bubble */}
          <div
            style={{
              background: 'white',
              borderRadius: '24px',
              padding: '16px 20px',
              boxShadow: '0 4px 16px rgba(16, 80, 98, 0.2)',
              border: '2px solid #1a6c7a',
              position: 'relative',
              opacity: showSpeechBubble ? 1 : 0,
              transform: showSpeechBubble ? 'translateY(0)' : 'translateY(10px)',
              transition: 'all 0.3s ease',
              maxWidth: '240px',
              pointerEvents: showSpeechBubble ? 'auto' : 'none'
            }}
          >
            <Text style={{
              color: '#105062',
              fontSize: '15px',
              fontWeight: 500,
              lineHeight: 1.3
            }}>
              {currentMessage}
            </Text>
            {/* Speech bubble tail */}
            <div
              style={{
                position: 'absolute',
                bottom: '-9px',
                right: '24px',
                width: '18px',
                height: '18px',
                background: 'white',
                border: '2px solid #1a6c7a',
                borderTop: 'none',
                borderLeft: 'none',
                transform: 'rotate(45deg)',
                zIndex: -1
              }}
            />
          </div>

          {/* Avatar Button */}
          <div
            onClick={toggleChat}
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #105062 0%, #1a6c7a 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(16, 80, 98, 0.4)',
              animation: 'floatAvatar 3s ease-in-out infinite',
              transition: 'all 0.3s ease',
              border: '3px solid rgba(255,255,255,0.9)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.boxShadow = '0 8px 25px rgba(16, 80, 98, 0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(16, 80, 98, 0.4)';
            }}
          >
            <RobotOutlined style={{ fontSize: '36px', color: 'white' }} />
          </div>
        </div>
      )}

      {/* Chat Side Panel */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: `${currentWidth}px`,
            height: '100vh',
            background: 'white',
            borderLeft: '1px solid #e8e8e8',
            zIndex: 999,
            display: 'flex',
            flexDirection: 'column',
            transition: 'width 0.3s ease',
            boxShadow: '-2px 0 8px rgba(0,0,0,0.1)'
          }}
        >
          {/* Chat Header */}
          <div
            style={{
              padding: '16px',
              background: 'linear-gradient(135deg, #105062 0%, #1a6c7a 100%)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <Space>
              <Avatar icon={<RobotOutlined />} style={{ background: 'rgba(255,255,255,0.2)' }} />
              <div>
                <Text strong style={{ color: 'white', fontSize: '16px' }}>IPSA Assistant</Text>
                <br />
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px' }}>
                  Powered by AI
                </Text>
              </div>
            </Space>
            <Space>
              <Button
                type="text"
                icon={isExpanded ? <CompressOutlined /> : <ExpandAltOutlined />}
                onClick={toggleExpand}
                style={{ color: 'white' }}
                title={isExpanded ? 'Collapse' : 'Expand'}
              />
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={toggleChat}
                style={{ color: 'white' }}
                title="Close Chat"
              />
            </Space>
          </div>

          {/* Messages Area */}
          <div
            style={{
              flex: 1,
              padding: '16px',
              overflowY: 'auto',
              background: '#fafafa'
            }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              {messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    display: 'flex',
                    justifyContent: message.type === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: '8px'
                  }}
                >
                  <div
                    style={{
                      maxWidth: '80%',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      flexDirection: message.type === 'user' ? 'row-reverse' : 'row'
                    }}
                  >
                    <Avatar
                      size="small"
                      icon={message.type === 'user' ? <UserOutlined /> : <RobotOutlined />}
                      style={{
                        background: message.type === 'user' ? '#1890ff' : '#105062',
                        flexShrink: 0
                      }}
                    />
                    <Card
                      size="small"
                      style={{
                        background: message.type === 'user' ? '#1890ff' : 'white',
                        color: message.type === 'user' ? 'white' : 'black',
                        border: message.type === 'user' ? 'none' : '1px solid #e8e8e8',
                        borderRadius: '12px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}
                      bodyStyle={{ padding: '8px 12px' }}
                    >
                      {message.type === 'user' ? (
                        <Paragraph
                          style={{
                            margin: 0,
                            color: 'white',
                            fontSize: '14px',
                            lineHeight: '1.4'
                          }}
                        >
                          {message.content}
                        </Paragraph>
                      ) : (
                        <div
                          className="chat-markdown"
                          style={{ fontSize: '14px', lineHeight: '1.4', color: 'inherit', wordBreak: 'break-word' }}
                        >
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      )}
                      <Text
                        style={{
                          fontSize: '10px',
                          color: message.type === 'user' ? 'rgba(255,255,255,0.8)' : '#999',
                          marginTop: '4px',
                          display: 'block'
                        }}
                      >
                        {formatTime(message.timestamp)}
                      </Text>
                    </Card>
                  </div>
                </div>
              ))}

              {isLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <Avatar
                      size="small"
                      icon={<RobotOutlined />}
                      style={{ background: '#105062' }}
                    />
                    <Card
                      size="small"
                      style={{
                        background: 'white',
                        border: '1px solid #e8e8e8',
                        borderRadius: '12px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}
                      bodyStyle={{ padding: '8px 12px' }}
                    >
                      <Space>
                        <Spin size="small" />
                        <Text style={{ fontSize: '14px', color: '#666' }}>Typing...</Text>
                      </Space>
                    </Card>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </Space>
          </div>

          {/* Input Area */}
          <div
            style={{
              padding: '16px',
              borderTop: '1px solid #e8e8e8',
              background: 'white'
            }}
          >
            <Space.Compact style={{ width: '100%' }}>
              <TextArea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                autoSize={{ minRows: 1, maxRows: 4 }}
                style={{ resize: 'none' }}
                disabled={isLoading}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSendMessage}
                loading={isLoading}
                style={{
                  background: 'linear-gradient(135deg, #105062 0%, #1a6c7a 100%)',
                  border: 'none',
                  height: 'auto'
                }}
              />
            </Space.Compact>

            {isExpanded && (
              <>
                <Divider style={{ margin: '12px 0 8px 0' }} />
                <Text style={{ fontSize: '12px', color: '#999' }}>
                  💡 Ask me about pathway analysis, data interpretation, or IPSA features
                </Text>
              </>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
};

export default ChatSidePanel;