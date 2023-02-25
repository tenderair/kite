
export interface MetaTag {
    type: string,
    value?: any;
}

export interface ParameterMeta extends MetaTag {
    index: number;
}

export interface MethodMeta {
    tags: MetaTag[];
    name: string | symbol;
    parameters: ParameterMeta[];
    results: MetaTag[];
}

export interface PropertyMeta {
    tags: MetaTag[];
    name: string | symbol;
}

export interface RouterMeta {
    name: string,
    route: (...args: any[]) => void;
}

export interface KiteMetadata {
    name?: string,
    type?: string,      //Controller/Service
    value?: any,
    construction: MethodMeta,           //构造函数
    methods: Record<string | symbol, MethodMeta>;
    properties: Record<string | symbol, PropertyMeta>;
    tags: MetaTag[];
    routers: Record<string, RouterMeta>;
}