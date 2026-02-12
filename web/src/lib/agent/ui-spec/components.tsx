import React from "react";
import type { ComponentRegistry, ComponentRenderProps } from "@json-render/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChevronDown } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

/**
 * Map badge variant from the spec to existing Onyx Badge variants.
 */
function mapBadgeVariant(
  variant?: string
): "default" | "success" | "destructive" | "in_progress" | "outline" {
  switch (variant) {
    case "success":
      return "success";
    case "error":
      return "destructive";
    case "warning":
      // "invalid" maps to orange/warning styling in Onyx badge
      return "default";
    case "info":
      return "in_progress";
    default:
      return "default";
  }
}

/**
 * Map alert variant to Tailwind classes.
 */
function alertClasses(variant?: string): string {
  switch (variant) {
    case "success":
      return "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200";
    case "error":
      return "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200";
    case "warning":
      return "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200";
    case "info":
    default:
      return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200";
  }
}

// Helper type for element props
type Props = Record<string, unknown>;

function CardComponent({ element, children }: ComponentRenderProps<Props>) {
  const title = element.props.title as string | undefined;
  const description = element.props.description as string | undefined;
  return (
    <Card className="mb-3">
      {(title || description) && (
        <CardHeader className="pb-3">
          {title && <CardTitle className="text-lg">{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={title || description ? "" : "pt-6"}>
        {children}
      </CardContent>
    </Card>
  );
}

function StackComponent({ element, children }: ComponentRenderProps<Props>) {
  const direction = (element.props.direction as string) || "vertical";
  const gap = (element.props.gap as string) || "md";
  const align = (element.props.align as string) || "stretch";
  const justify = (element.props.justify as string) || "start";

  const gapClasses: Record<string, string> = {
    none: "gap-0",
    sm: "gap-1",
    md: "gap-3",
    lg: "gap-6",
  };
  const alignClasses: Record<string, string> = {
    start: "items-start",
    center: "items-center",
    end: "items-end",
    stretch: "items-stretch",
  };
  const justifyClasses: Record<string, string> = {
    start: "justify-start",
    center: "justify-center",
    end: "justify-end",
    between: "justify-between",
  };

  const dirClass = direction === "horizontal" ? "flex-row" : "flex-col";

  return (
    <div
      className={`flex ${dirClass} ${gapClasses[gap] || "gap-3"} ${alignClasses[align] || "items-stretch"} ${justifyClasses[justify] || "justify-start"} mb-3`}
    >
      {children}
    </div>
  );
}

function GridComponent({ element, children }: ComponentRenderProps<Props>) {
  const columns = (element.props.columns as number) || 2;
  const gap = (element.props.gap as string) || "md";

  const colClasses: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
    5: "grid-cols-5",
    6: "grid-cols-6",
  };
  const gapClasses: Record<string, string> = {
    sm: "gap-2",
    md: "gap-4",
    lg: "gap-6",
  };

  return (
    <div
      className={`grid ${colClasses[columns] || "grid-cols-2"} ${gapClasses[gap] || "gap-4"} mb-3`}
    >
      {children}
    </div>
  );
}

function HeadingComponent({ element }: ComponentRenderProps<Props>) {
  const level = element.props.level as number;
  const text = element.props.text as string;
  const Tag = `h${level}` as keyof JSX.IntrinsicElements;
  const sizeClasses: Record<number, string> = {
    1: "text-2xl font-bold",
    2: "text-xl font-semibold",
    3: "text-lg font-semibold",
    4: "text-base font-medium",
  };
  const sizeClass = sizeClasses[level] || "text-base font-medium";
  return <Tag className={`${sizeClass} mb-2`}>{text}</Tag>;
}

function TextComponent({ element }: ComponentRenderProps<Props>) {
  const text = element.props.text as string;
  const variant = (element.props.variant as string) || "default";
  const variantClasses: Record<string, string> = {
    muted: "text-neutral-500 dark:text-neutral-400",
    bold: "font-semibold",
    default: "",
  };
  const variantClass = variantClasses[variant] || "";
  return <p className={`mb-2 ${variantClass}`}>{text}</p>;
}

function TableComponent({ element }: ComponentRenderProps<Props>) {
  const columns = element.props.columns as Array<{ key: string; label: string }>;
  const rows = element.props.rows as Array<Record<string, unknown>>;
  return (
    <div className="mb-3">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col.key}>
                  {String(row[col.key] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BadgeComponent({ element }: ComponentRenderProps<Props>) {
  const text = element.props.text as string;
  const variant = element.props.variant as string | undefined;
  return (
    <Badge variant={mapBadgeVariant(variant)} className="mb-2 mr-1">
      {text}
    </Badge>
  );
}

function AlertComponent({ element }: ComponentRenderProps<Props>) {
  const title = element.props.title as string | undefined;
  const message = element.props.message as string;
  const variant = element.props.variant as string | undefined;
  return (
    <div className={`rounded-lg border p-4 mb-3 ${alertClasses(variant)}`}>
      {title && <p className="font-semibold mb-1">{title}</p>}
      <p className="text-sm">{message}</p>
    </div>
  );
}

function ProgressBarComponent({ element }: ComponentRenderProps<Props>) {
  const value = element.props.value as number;
  const label = element.props.label as string | undefined;
  return (
    <div className="mb-3">
      {label && (
        <div className="flex justify-between mb-1 text-sm">
          <span>{label}</span>
          <span className="text-neutral-500 dark:text-neutral-400">{value}%</span>
        </div>
      )}
      <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-2.5">
        <div
          className="bg-blue-600 dark:bg-blue-500 h-2.5 rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

function KeyValueComponent({ element }: ComponentRenderProps<Props>) {
  const items = element.props.items as Array<{ key: string; value: string }>;
  return (
    <div className="mb-3 space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex justify-between py-1 text-sm">
          <span className="text-neutral-500 dark:text-neutral-400">{item.key}</span>
          <span className="font-medium">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function ListComponent({ element }: ComponentRenderProps<Props>) {
  const items = element.props.items as string[];
  const ordered = element.props.ordered as boolean | undefined;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`mb-3 pl-5 space-y-1 text-sm ${ordered ? "list-decimal" : "list-disc"}`}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </Tag>
  );
}

function SeparatorComponent() {
  return <Separator className="my-3" />;
}

function CodeBlockComponent({ element }: ComponentRenderProps<Props>) {
  const code = element.props.code as string;
  const language = element.props.language as string | undefined;
  return (
    <pre className="mb-3 rounded-lg bg-neutral-100 dark:bg-neutral-900 p-4 overflow-x-auto text-sm">
      <code className={language ? `language-${language}` : ""}>{code}</code>
    </pre>
  );
}

function AvatarComponent({ element }: ComponentRenderProps<Props>) {
  const name = element.props.name as string;
  const size = (element.props.size as string) || "md";

  const sizeClasses: Record<string, string> = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-lg",
  };

  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts.length >= 2 ? (parts[parts.length - 1] ?? "") : "";
  const initials = parts.length >= 2
    ? `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase()
    : name.slice(0, 2).toUpperCase();

  return (
    <Avatar className={`mb-2 ${sizeClasses[size] || "h-10 w-10 text-sm"}`}>
      <AvatarFallback className={sizeClasses[size] || "text-sm"}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

function AccordionComponent({ element }: ComponentRenderProps<Props>) {
  const items = element.props.items as Array<{ title: string; content: string }>;
  const accordionType = (element.props.type as "single" | "multiple") || "single";

  if (accordionType === "multiple") {
    return (
      <Accordion type="multiple" className="mb-3">
        {items.map((item, i) => (
          <AccordionItem key={i} value={`item-${i}`}>
            <AccordionTrigger>{item.title}</AccordionTrigger>
            <AccordionContent>{item.content}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    );
  }

  return (
    <Accordion type="single" collapsible className="mb-3">
      {items.map((item, i) => (
        <AccordionItem key={i} value={`item-${i}`}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>{item.content}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function CollapsibleComponent({ element, children }: ComponentRenderProps<Props>) {
  const title = element.props.title as string;
  const defaultOpen = (element.props.defaultOpen as boolean) ?? false;

  return (
    <Collapsible defaultOpen={defaultOpen} className="mb-3">
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-neutral-200 dark:border-neutral-700 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors [&[data-state=open]>svg]:rotate-180">
        {title}
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function TabsComponent({ element }: ComponentRenderProps<Props>) {
  const tabs = element.props.tabs as Array<{ label: string; value: string; content: string }>;
  const defaultValue = (element.props.defaultValue as string) || tabs[0]?.value || "tab-0";

  return (
    <Tabs defaultValue={defaultValue} className="mb-3">
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <p className="text-sm">{tab.content}</p>
        </TabsContent>
      ))}
    </Tabs>
  );
}

function BarGraphComponent({ element }: ComponentRenderProps<Props>) {
  const title = element.props.title as string | undefined;
  const data = element.props.data as Array<{ label: string; value: number }>;
  const color = (element.props.color as string) || "#3b82f6";

  return (
    <div className="mb-3">
      {title && <p className="text-sm font-semibold mb-2">{title}</p>}
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LineGraphComponent({ element }: ComponentRenderProps<Props>) {
  const title = element.props.title as string | undefined;
  const data = element.props.data as Array<{ label: string; value: number }>;
  const color = (element.props.color as string) || "#3b82f6";

  return (
    <div className="mb-3">
      {title && <p className="text-sm font-semibold mb-2">{title}</p>}
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Component registry mapping catalog component types to React components.
 * Uses existing Onyx UI library components where available.
 *
 * Cast needed because @json-render/react targets React 19 (ReactNode return)
 * but this project uses React 18 (ReactElement | null return).
 */
export const registry = {
  Card: CardComponent,
  Stack: StackComponent,
  Grid: GridComponent,
  Heading: HeadingComponent,
  Text: TextComponent,
  Table: TableComponent,
  Badge: BadgeComponent,
  Alert: AlertComponent,
  ProgressBar: ProgressBarComponent,
  KeyValue: KeyValueComponent,
  List: ListComponent,
  Separator: SeparatorComponent,
  CodeBlock: CodeBlockComponent,
  Avatar: AvatarComponent,
  Accordion: AccordionComponent,
  Collapsible: CollapsibleComponent,
  Tabs: TabsComponent,
  BarGraph: BarGraphComponent,
  LineGraph: LineGraphComponent,
} as unknown as ComponentRegistry;
