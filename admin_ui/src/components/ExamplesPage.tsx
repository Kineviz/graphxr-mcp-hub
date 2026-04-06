import { useEffect, useState } from 'react';
import { Card, Typography, Spin, Empty, message, Tag, Button, theme } from 'antd';
import { CodeOutlined, CopyOutlined } from '@ant-design/icons';
import * as api from '../api/client';

const { Text } = Typography;

interface ExampleFile {
  name: string;
  content: string;
}

const LANG_MAP: Record<string, string> = {
  '.html': 'HTML', '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.py': 'Python', '.json': 'JSON',
  '.yaml': 'YAML', '.yml': 'YAML', '.md': 'Markdown',
};

function getLanguage(name: string): string {
  const ext = name.slice(name.lastIndexOf('.'));
  return LANG_MAP[ext] ?? 'Text';
}

export default function ExamplesPage() {
  const { token } = theme.useToken();
  const [examples, setExamples] = useState<ExampleFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getExamples()
      .then(setExamples)
      .catch(() => message.error('Failed to load examples'))
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = (content: string, name: string) => {
    navigator.clipboard.writeText(content).then(
      () => message.success(`Copied: ${name}`),
      () => message.error('Copy failed'),
    );
  };

  if (loading) return <Spin size="large" style={{ display: 'block', textAlign: 'center', padding: 80 }} />;
  if (examples.length === 0) return <Empty description="No examples found in /examples directory" />;

  return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Integration examples from the <Text code>examples/</Text> directory. Copy and adapt for your own integrations.
      </Text>
      {examples.map((ex) => (
        <Card
          key={ex.name}
          title={
            <span>
              <CodeOutlined style={{ marginRight: 8 }} />
              {ex.name}
              <Tag color="blue" style={{ marginLeft: 8 }}>{getLanguage(ex.name)}</Tag>
            </span>
          }
          size="small"
          style={{ marginBottom: 16 }}
          extra={
            <Button size="small" icon={<CopyOutlined />} onClick={() => handleCopy(ex.content, ex.name)}>
              Copy
            </Button>
          }
        >
          <pre style={{
            background: token.colorBgLayout,
            color: token.colorText,
            border: `1px solid ${token.colorBorder}`,
            borderRadius: 6,
            padding: 12,
            fontSize: 12,
            fontFamily: 'Consolas, Monaco, monospace',
            maxHeight: 400,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            margin: 0,
          }}>
            {ex.content}
          </pre>
        </Card>
      ))}
    </div>
  );
}
