
export interface MetaTag {
    type: string,
    value?: any;
}
export interface MethodMeta {
    parameters: MetaTag[];
    tags: MetaTag[];
}

export interface ClassMeta {
    name?: string,
    type?: string,
    methods: { [key: string | symbol]: MethodMeta };
    properties: { [key: string | symbol]: MetaTag[] };
    tags: MetaTag[];
    self: MethodMeta,
}