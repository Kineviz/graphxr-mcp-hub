import { useCallback } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Spin, theme, Typography, Badge } from 'antd';
import {
  DatabaseOutlined,
  TeamOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { usePolling } from '../hooks/usePolling';
import { formatRelativeTime, formatFullTime } from '../utils/time';
import type { SourceInfo, LineageEntry } from '../types';
import * as api from '../api/client';

const { Text } = Typography;

interface DashboardData {
  sources: SourceInfo[];
  sessions: { activeSessions: number };
  lineage: { totalOperations: number; recent: LineageEntry[] };
}

export default function DashboardPage() {
  const { token } = theme.useToken();

  const fetchAll = useCallback(async (signal: AbortSignal): Promise<DashboardData> => {
    signal.throwIfAborted();
    const [sources, sessions, lineage] = await Promise.all([
      api.getSources(),
      api.getSessions(),
      api.getLineage(5),
    ]);
    return { sources, sessions, lineage };
  }, []);

  const { data, loading } = usePolling(fetchAll, 10000);

  if (loading || !data) return <Spin size="large" style={{ display: 'block', textAlign: 'center', padding: 80 }} />;

  const { sources, sessions, lineage } = data;
  const connected = sources.filter((s) => s.status === 'connected').length;
  const hasError = sources.some((s) => s.status === 'error');
  const healthStatus = hasError ? 'Degraded' : connected === sources.length && sources.length > 0 ? 'Healthy' : 'Partial';
  const healthColor = hasError ? token.colorError : connected === sources.length && sources.length > 0 ? token.colorSuccess : token.colorWarning;

  return (
    <div>
      {/* Stats Row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Connected Sources"
              value={connected}
              suffix={`/ ${sources.length}`}
              prefix={<DatabaseOutlined />}
              valueStyle={{ color: token.colorPrimary }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Active Sessions"
              value={sessions.activeSessions}
              prefix={<TeamOutlined />}
              valueStyle={{ color: token.colorPrimary }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total Operations"
              value={lineage.totalOperations}
              prefix={<BranchesOutlined />}
              valueStyle={{ color: token.colorPrimary }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="System Health"
              value={healthStatus}
              prefix={hasError ? <ExclamationCircleOutlined /> : <CheckCircleOutlined />}
              valueStyle={{ color: healthColor }}
            />
          </Card>
        </Col>
      </Row>

      {/* Detail Row */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Source Status" size="small">
            {sources.length === 0 ? (
              <Text type="secondary">No sources configured</Text>
            ) : (
              sources.map((s) => (
                <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                  <div>
                    <Text strong>{s.name}</Text>
                    <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{s.transport}</Text>
                  </div>
                  <Badge
                    status={s.status === 'connected' ? 'success' : s.status === 'error' ? 'error' : s.status === 'connecting' ? 'processing' : 'default'}
                    text={s.status}
                  />
                </div>
              ))
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Recent Operations" size="small">
            <Table
              dataSource={lineage.recent}
              rowKey="operationId"
              pagination={false}
              size="small"
              columns={[
                {
                  title: 'Operation',
                  dataIndex: 'operation',
                  key: 'operation',
                  render: (op: string) => <Tag color="green">{op}</Tag>,
                },
                { title: 'Nodes', dataIndex: 'nodeCount', key: 'nodeCount', width: 60 },
                { title: 'Edges', dataIndex: 'edgeCount', key: 'edgeCount', width: 60 },
                {
                  title: 'Time',
                  dataIndex: 'timestamp',
                  key: 'timestamp',
                  render: (t: string) => (
                    <Typography.Text type="secondary" title={formatFullTime(t)}>
                      <ClockCircleOutlined style={{ marginRight: 4 }} />
                      {formatRelativeTime(t)}
                    </Typography.Text>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
