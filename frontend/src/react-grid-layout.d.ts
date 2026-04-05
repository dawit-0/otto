declare module 'react-grid-layout' {
  import * as React from 'react';

  export interface LayoutItem {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
    static?: boolean;
    isDraggable?: boolean;
    isResizable?: boolean;
  }

  export interface GridLayoutProps {
    layout?: LayoutItem[];
    cols?: number;
    rowHeight?: number;
    width?: number;
    margin?: [number, number];
    compactType?: 'vertical' | 'horizontal' | null;
    draggableHandle?: string;
    onLayoutChange?: (layout: LayoutItem[]) => void;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
  }

  export interface ResponsiveProps extends Omit<GridLayoutProps, 'cols' | 'layout'> {
    layouts?: Record<string, LayoutItem[]>;
    breakpoints?: Record<string, number>;
    cols?: Record<string, number>;
    onLayoutChange?: (layout: LayoutItem[], layouts: Record<string, LayoutItem[]>) => void;
  }

  export function Responsive(props: ResponsiveProps): React.ReactElement;
  export function useContainerWidth(opts?: { measureBeforeMount?: boolean }): [React.RefCallback<HTMLElement>, number];

  export default function GridLayout(props: GridLayoutProps): React.ReactElement;
}

declare module 'react-grid-layout/css/styles.css' {
  const content: string;
  export default content;
}

declare module 'react-resizable/css/styles.css' {
  const content: string;
  export default content;
}
