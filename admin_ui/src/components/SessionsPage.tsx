import { useCallback } from 'react';
import { Table, Statistic, Row, Col, Card, Button, Typography, Tooltip, theme, Spin } from 'antd';
import { ReloadOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { usePolling } from '../hooks/usePolling';
import { formatRelativeTime, formatFullTime } from '../utils/time';
import type { SessionInfo } from '../types';
import * as api from '../api/client';

const { Text } = Typography;

export default function SessionsPage() {
  const { token } = theme.useToken();

  const fetchSessions = useCallback(async (signal: AbortSignal) => {
    signal.throwIfAborted();
    return api.getSessions();
  }, []);

  const { data, loading, refresh } = usePolling(fetchSessions, 10000);

  if (loading || !data) return <Spin size="large" style={{ display: 'block', textAlign: 'center', padding: 80 }} />;

  const columns = [
    {
      title: 'Session ID',
      dataIndex: 'sessionId',
      key: 'sessionId',
      render: (id: string) => (
        <Tooltip title={id}>
          <Typography.Paragraph
            copyable={{ text: id }}
            style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}
          >
            {id.slice(0, 16)}...
          </Typography.Paragraph>
        </Tooltip>
      ),
    },
    {
      title: 'User Agent',
      dataIndex: 'userAgent',
      key: 'userAgent',
      ellipsis: { showTitle: false },
      render: (ua?: string) => ua ? (
        <Tooltip title={ua}>
          <Text type="secondary" style={{ fontSize: 12 }}>{ua.slice(0, 40)}{ua.length > 40 ? '...' : ''}</Text>
        </Tooltip>
      ) : <Text type="secondary">—</Text>,
    },
    {
      title: 'Connected',
      dataIndex: 'connectedAt',
      key: 'connectedAt',
      sorter: (a: SessionInfo, b: SessionInfo) => new Date(a.connectedAt).getTime() - new Date(b.connectedAt).getTime(),
      render: (t: string) => (
        <Tooltip title={formatFullTime(t)}>
          <Text type="secondary">
            <ClockCircleOutlined style={{ marginRight: 4 }} />
            {formatRelativeTime(t)}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Last Activity',
      dataIndex: 'lastActivity',
      key: 'lastActivity',
      defaultSortOrder: 'descend' as const,
      sorter: (a: SessionInfo, b: SessionInfo) => new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime(),
      render: (t: string) => (
        <Tooltip title={formatFullTime(t)}>
          <Text type="secondary">
            <ClockCircleOutlined style={{ marginRight: 4 }} />
            {formatRelativeTime(t)}
          </Text>
        </Tooltip>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col>
          <Card size="small">
            <Statistic title="Connected Clients" value={data.activeSessions} valueStyle={{ color: token.colorPrimary }} />
          </Card>
        </Col>
        <Col flex="auto" style={{ textAlign: 'right', paddingTop: 12 }}>
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
        </Col>
      </Row>
      <Table
        dataSource={data.sessions}
        columns={columns}
        rowKey="sessionId"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} sessions` }}
        size="small"
      />
    </div>
  );
}
