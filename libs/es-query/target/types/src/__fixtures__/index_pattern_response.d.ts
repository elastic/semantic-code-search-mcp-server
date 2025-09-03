export declare const indexPatternResponse: {
    id: string;
    title: string;
    fields: ({
        name: string;
        type: string;
        esTypes: string[];
        count: number;
        scripted: boolean;
        searchable: boolean;
        aggregatable: boolean;
        readFromDocValues: boolean;
        subType?: undefined;
        script?: undefined;
        lang?: undefined;
    } | {
        name: string;
        type: string;
        esTypes: string[];
        count: number;
        scripted: boolean;
        searchable: boolean;
        aggregatable: boolean;
        readFromDocValues: boolean;
        subType: {
            multi: {
                parent: string;
            };
            nested?: undefined;
        };
        script?: undefined;
        lang?: undefined;
    } | {
        name: string;
        type: string;
        count: number;
        scripted: boolean;
        script: string;
        lang: string;
        searchable: boolean;
        aggregatable: boolean;
        readFromDocValues: boolean;
        esTypes?: undefined;
        subType?: undefined;
    } | {
        name: string;
        type: string;
        esTypes: string[];
        count: number;
        scripted: boolean;
        searchable: boolean;
        aggregatable: boolean;
        readFromDocValues: boolean;
        subType: {
            nested: {
                path: string;
            };
            multi?: undefined;
        };
        script?: undefined;
        lang?: undefined;
    })[];
};
