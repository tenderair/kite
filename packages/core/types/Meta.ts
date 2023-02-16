
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

export interface ClassMeta {
    name?: string,
    type?: string,
    value?: any,
    methods: { [key: string | symbol]: MethodMeta };
    properties: { [key: string | symbol]: MetaTag[] };
    tags: MetaTag[];
    self: MethodMeta,           //构造函数
}