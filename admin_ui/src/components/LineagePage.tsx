import { useCallback, useMemo } from 'react';
import { Table, Tag, Statistic, Row, Col, Card, Button, Typography, Tooltip, theme, Spin } from 'antd';
import { ReloadOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { usePolling } from '../hooks/usePolling';
import { formatRelativeTime, formatFullTime } from '../utils/time';
import type { LineageEntry } from '../types';
import * as api from '../api/client';

const { Text } = Typography;

export default function LineagePage() {
  const { token } = theme.useToken();

  const fetchLineage = useCallback(async (signal: AbortSignal) => {
    signal.throwIfAborted();
    return api.getLineage(100);
  }, []);

  const { data, loading, refresh } = usePolling(fetchLineage, 10000);

  // Dynamic filters from data
  const operationFilters = useMemo(() => {
    if (!data) return [];
    const ops = [...new Set(data.recent.map((r) => r.operation))];
    return ops.map((op) => ({ text: op, value: op }));
  }, [data]);

  const sourceFilters = useMemo(() => {
    if (!data) return [];
    const srcs = [...new Set(data.recent.map((r) => r.source))];
    return srcs.map((s) => ({ text: s, value: s }));
  }, [data]);

  if (loading || !data) return <Spin size="large" style={{ display: 'block', textAlign: 'center', padding: 80 }} />;

  const columns = [
    {
      title: 'Operation',
      dataIndex: 'operation',
      key: 'operation',
      filters: operationFilters,
      onFilter: (value: unknown, record: LineageEntry) => record.operation === value,
      render: (op: string) => <Tag color="green">{op}</Tag>,
    },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      filters: sourceFilters,
      onFilter: (value: unknown, record: LineageEntry) => record.source === value,
      render: (s: string) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{s}</Text>,
    },
    {
      title: 'Nodes',
      dataIndex: 'nodeCount',
      key: 'nodeCount',
      width: 80,
      sorter: (a: LineageEntry, b: LineageEntry) => a.nodeCount - b.nodeCount,
    },
    {
      title: 'Edges',
      dataIndex: 'edgeCount',
      key: 'edgeCount',
      width: 80,
      sorter: (a: LineageEntry, b: LineageEntry) => a.edgeCount - b.edgeCount,
    },
    {
      title: 'Time',
      dataIndex: 'timestamp',
      key: 'timestamp',
      defaultSortOrder: 'descend' as const,
      sorter: (a: LineageEntry, b: LineageEntry) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
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
            <Statistic title="Total Operations" value={data.totalOperations} valueStyle={{ color: token.colorPrimary }} />
          </Card>
        </Col>
        <Col flex="auto" style={{ textAlign: 'right', paddingTop: 12 }}>
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
        </Col>
      </Row>
      <Table
        dataSource={data.recent}
        columns={columns}
        rowKey="operationId"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} operations` }}
        size="small"
      />
    </div>
  );
}
