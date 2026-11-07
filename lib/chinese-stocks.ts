export type ChineseStockItem = {
    symbol: string;
    name: string;
    pinyin: string[];
    keywords: string[];
    exchange: string;
    type: string;
};

export const CHINESE_STOCKS: ChineseStockItem[] = [
    // A 股 沪市核心
    { symbol: '600519.SS', name: '贵州茅台 (Kweichow Moutai)', pinyin: ['GZMT', 'MT', 'MAOTAI'], keywords: ['茅台', '贵州茅台', '白酒'], exchange: '上海证券交易所', type: '白酒蓝筹' },
    { symbol: '601318.SS', name: '中国平安 (Ping An Insurance)', pinyin: ['ZGPA', 'PA', 'PINGAN'], keywords: ['中国平安', '平安', '保险'], exchange: '上海证券交易所', type: '金融保险' },
    { symbol: '600036.SS', name: '招商银行 (China Merchants Bank)', pinyin: ['ZSYH', 'ZS', 'ZHAOSHANG'], keywords: ['招商银行', '招行', '银行'], exchange: '上海证券交易所', type: '银行蓝筹' },
    { symbol: '601398.SS', name: '工商银行 (ICBC)', pinyin: ['GSYH', 'ICBC'], keywords: ['工商银行', '工行'], exchange: '上海证券交易所', type: '国有大行' },
    { symbol: '600900.SS', name: '长江电力 (China Yangtze Power)', pinyin: ['CJDL', 'CHANGDIAN'], keywords: ['长江电力', '长电', '水电'], exchange: '上海证券交易所', type: '公用事业' },
    { symbol: '688981.SS', name: '中芯国际 (SMIC)', pinyin: ['ZXGJ', 'SMIC'], keywords: ['中芯国际', '中芯', '半导体', '晶圆'], exchange: '上海证券交易所 (科创板)', type: '芯片制造' },
    { symbol: '601138.SS', name: '工业富联 (Foxconn Industrial Internet)', pinyin: ['GYFL', 'FLL'], keywords: ['工业富联', '富士康', '服务器'], exchange: '上海证券交易所', type: 'AI算力制造' },
    { symbol: '600276.SS', name: '恒瑞医药 (Hengrui Medicine)', pinyin: ['HRYY', 'HENGRUI'], keywords: ['恒瑞医药', '恒瑞', '医药', '创新药'], exchange: '上海证券交易所', type: '医药健康' },
    { symbol: '601857.SS', name: '中国石油 (PetroChina)', pinyin: ['ZGSY', 'ZHONGSHIYOU'], keywords: ['中国石油', '中石油', '石油'], exchange: '上海证券交易所', type: '能源化工' },
    { symbol: '600941.SS', name: '中国移动 (China Mobile)', pinyin: ['ZGYD', 'YIDONG'], keywords: ['中国移动', '中移动', '通信'], exchange: '上海证券交易所', type: '通信运营商' },
    { symbol: '601899.SS', name: '紫金矿业 (Zijin Mining)', pinyin: ['ZJKY', 'ZIJIN'], keywords: ['紫金矿业', '紫金', '黄金', '铜矿'], exchange: '上海证券交易所', type: '有色金属' },
    { symbol: '601988.SS', name: '中国银行 (Bank of China)', pinyin: ['ZGYH', 'BOC'], keywords: ['中国银行', '中行'], exchange: '上海证券交易所', type: '银行蓝筹' },
    { symbol: '601288.SS', name: '农业银行 (Agricultural Bank of China)', pinyin: ['NYYH', 'ABC'], keywords: ['农业银行', '农行'], exchange: '上海证券交易所', type: '银行蓝筹' },
    { symbol: '601668.SS', name: '中国建筑 (China State Construction)', pinyin: ['ZGJZ'], keywords: ['中国建筑', '中建', '基建'], exchange: '上海证券交易所', type: '基础建设' },
    { symbol: '600030.SS', name: '中信证券 (CITIC Securities)', pinyin: ['ZXZQ', 'CITIC'], keywords: ['中信证券', '中信', '券商'], exchange: '上海证券交易所', type: '证券券商' },
    { symbol: '688012.SS', name: '中微公司 (AMEC)', pinyin: ['ZWGS', 'AMEC'], keywords: ['中微公司', '中微', '刻蚀机', '半导体设备'], exchange: '上海证券交易所 (科创板)', type: '半导体设备' },
    { symbol: '688041.SS', name: '海光信息 (Hygon Information)', pinyin: ['HGXX', 'HYGON'], keywords: ['海光信息', '海光', 'CPU', 'DCU', '国产算力'], exchange: '上海证券交易所 (科创板)', type: '芯片设计' },
    { symbol: '688256.SS', name: '寒武纪 (Cambricon)', pinyin: ['HWJ', 'CAMBRICON'], keywords: ['寒武纪', 'AI芯片', '算力'], exchange: '上海证券交易所 (科创板)', type: 'AI芯片' },

    // A 股 深市核心
    { symbol: '300750.SZ', name: '宁德时代 (CATL)', pinyin: ['NDSD', 'CATL'], keywords: ['宁德时代', '宁德', '动力电池', '储能'], exchange: '深圳证券交易所 (创业板)', type: '新能源' },
    { symbol: '002594.SZ', name: '比亚迪 (BYD)', pinyin: ['BYD'], keywords: ['比亚迪', '新能源车', '电车', '刀片电池'], exchange: '深圳证券交易所', type: '新能源汽车' },
    { symbol: '000858.SZ', name: '五粮液 (Wuliangye)', pinyin: ['WLY', 'WULIANGYE'], keywords: ['五粮液', '白酒'], exchange: '深圳证券交易所', type: '白酒蓝筹' },
    { symbol: '000333.SZ', name: '美的集团 (Midea Group)', pinyin: ['MDJT', 'MD', 'MIDEA'], keywords: ['美的集团', '美的', '家电'], exchange: '深圳证券交易所', type: '白色家电' },
    { symbol: '000651.SZ', name: '格力电器 (Gree Electric)', pinyin: ['GLDQ', 'GL', 'GREE'], keywords: ['格力电器', '格力', '空调'], exchange: '深圳证券交易所', type: '白色家电' },
    { symbol: '300760.SZ', name: '迈瑞医疗 (Mindray)', pinyin: ['MRYL', 'MAIRUI'], keywords: ['迈瑞医疗', '迈瑞', '医疗器械'], exchange: '深圳证券交易所 (创业板)', type: '医疗设备' },
    { symbol: '002415.SZ', name: '海康威视 (Hikvision)', pinyin: ['HKWS', 'HIKVISION'], keywords: ['海康威视', '海康', '安防', 'AI视觉'], exchange: '深圳证券交易所', type: '智能物联网' },
    { symbol: '002241.SZ', name: '歌尔股份 (Goertek)', pinyin: ['GEGF', 'GOERTEK'], keywords: ['歌尔股份', '歌尔', '声学', 'VR'], exchange: '深圳证券交易所', type: '消费电子' },
    { symbol: '300124.SZ', name: '汇川技术 (Inovance)', pinyin: ['HCJS', 'INOVANCE'], keywords: ['汇川技术', '汇川', '工控', '机器人', '变频器'], exchange: '深圳证券交易所 (创业板)', type: '工业自动化' },
    { symbol: '000063.SZ', name: '中兴通讯 (ZTE)', pinyin: ['ZXTX', 'ZTE'], keywords: ['中兴通讯', '中兴', '5G', '通信设备'], exchange: '深圳证券交易所', type: '通信设备' },
    { symbol: '002475.SZ', name: '立讯精密 (Luxshare Precision)', pinyin: ['LXJM', 'LUXSHARE'], keywords: ['立讯精密', '立讯', '果链', '连接器'], exchange: '深圳证券交易所', type: '消费电子' },
    { symbol: '000725.SZ', name: '京东方A (BOE Technology)', pinyin: ['JDF', 'BOE'], keywords: ['京东方', '面板', 'OLED'], exchange: '深圳证券交易所', type: '半导体显示' },
    { symbol: '002230.SZ', name: '科大讯飞 (iFLYTEK)', pinyin: ['KDXF', 'IFLYTEK'], keywords: ['科大讯飞', '讯飞', '大模型', '语音AI'], exchange: '深圳证券交易所', type: '人工智能' },
    { symbol: '300059.SZ', name: '东方财富 (East Money Information)', pinyin: ['DFCF', 'EM'], keywords: ['东方财富', '东财', '互联网券商'], exchange: '深圳证券交易所 (创业板)', type: '金融信息服务' },
    { symbol: '002049.SZ', name: '紫光国微 (Guowei)', pinyin: ['ZGGW'], keywords: ['紫光国微', '紫光', '安全芯片', '特种IC'], exchange: '深圳证券交易所', type: '芯片设计' },

    // 港股核心
    { symbol: '0700.HK', name: '腾讯控股 (Tencent)', pinyin: ['TXKG', 'TX', 'TENCENT'], keywords: ['腾讯控股', '腾讯', '微信', '游戏'], exchange: '香港交易所', type: '科技互联网' },
    { symbol: '9988.HK', name: '阿里巴巴 (Alibaba)', pinyin: ['ALBB', 'AL', 'BABA'], keywords: ['阿里巴巴', '阿里', '淘宝', '天猫', '阿里云'], exchange: '香港交易所', type: '电商云计算' },
    { symbol: '3690.HK', name: '美团 (Meituan)', pinyin: ['MT', 'MEITUAN'], keywords: ['美团', '外卖', '本地生活'], exchange: '香港交易所', type: '生活服务平台' },
    { symbol: '1810.HK', name: '小米集团 (Xiaomi)', pinyin: ['XMJT', 'XM', 'XIAOMI'], keywords: ['小米集团', '小米', '雷军', 'SU7', '手机'], exchange: '香港交易所', type: '智能硬件' },
    { symbol: '9888.HK', name: '百度集团 (Baidu)', pinyin: ['BDJT', 'BD', 'BAIDU'], keywords: ['百度集团', '百度', '文心一言', '自动驾驶'], exchange: '香港交易所', type: '搜索与AI' },
    { symbol: '9618.HK', name: '京东集团 (JD.com)', pinyin: ['JDJT', 'JD'], keywords: ['京东集团', '京东', '电商物流'], exchange: '香港交易所', type: '零售物流' },
    { symbol: '0005.HK', name: '汇丰控股 (HSBC Holdings)', pinyin: ['HFKG', 'HSBC'], keywords: ['汇丰控股', '汇丰', '大笨象'], exchange: '香港交易所', type: '国际银行' },
    { symbol: '1299.HK', name: '友邦保险 (AIA Group)', pinyin: ['YBBX', 'AIA'], keywords: ['友邦保险', '友邦'], exchange: '香港交易所', type: '跨国保险' },
    { symbol: '0388.HK', name: '香港交易所 (HKEX)', pinyin: ['XGJYS', 'HKEX'], keywords: ['香港交易所', '港交所'], exchange: '香港交易所', type: '交易所金融' },
    { symbol: '1211.HK', name: '比亚迪股份 (BYD Co.)', pinyin: ['BYD'], keywords: ['比亚迪股份', '比亚迪港股'], exchange: '香港交易所', type: '汽车制造' },
    { symbol: '2015.HK', name: '理想汽车 (Li Auto)', pinyin: ['LXQC', 'LI'], keywords: ['理想汽车', '理想', '增程车'], exchange: '香港交易所', type: '造车新势力' },
    { symbol: '9866.HK', name: '蔚来 (NIO)', pinyin: ['WL', 'NIO'], keywords: ['蔚来汽车', '蔚来', '换电'], exchange: '香港交易所', type: '造车新势力' },
    { symbol: '9868.HK', name: '小鹏汽车 (XPeng)', pinyin: ['XPQC', 'XPENG'], keywords: ['小鹏汽车', '小鹏'], exchange: '香港交易所', type: '造车新势力' },
    { symbol: '0400.HK', name: '硬蛋创新 (Ingdan, Inc.)', pinyin: ['YD', 'INGDAN', 'KOGOBIG'], keywords: ['硬蛋创新', '科通芯城', '硬蛋'], exchange: '香港交易所', type: '电子芯片分销' },
    { symbol: '0981.HK', name: '中芯国际港股 (SMIC HK)', pinyin: ['ZXGJ'], keywords: ['中芯国际港股'], exchange: '香港交易所', type: '芯片制造' },
    { symbol: '2800.HK', name: '盈富基金 (Tracker Fund)', pinyin: ['YFJJ'], keywords: ['盈富基金', '恒指ETF'], exchange: '香港交易所', type: '指数ETF' },
    { symbol: '3033.HK', name: '南方恒生科技 (CSOP Hang Seng Tech)', pinyin: ['NFHSKJ'], keywords: ['南方恒生科技', '恒科ETF'], exchange: '香港交易所', type: '指数ETF' },

    // 台股核心
    { symbol: '2330.TW', name: '台积电 (TSMC)', pinyin: ['TJD', 'TSMC'], keywords: ['台积电', '台积', '晶圆代工'], exchange: '台湾证券交易所', type: '半导体先进制程' },
    { symbol: '2317.TW', name: '鸿海 (Hon Hai / Foxconn)', pinyin: ['HH', 'FTHH', 'FOXCONN'], keywords: ['鸿海', '富士康', '代工'], exchange: '台湾证券交易所', type: '电子代工' },
    { symbol: '2454.TW', name: '联发科 (MediaTek)', pinyin: ['LFK', 'MEDIATEK', 'MTK'], keywords: ['联发科', '天玑芯片', '手机Soc'], exchange: '台湾证券交易所', type: '芯片设计' },
    { symbol: '2308.TW', name: '台达电 (Delta Electronics)', pinyin: ['TDD', 'DELTA'], keywords: ['台达电', '电源管理', '储能伺服'], exchange: '台湾证券交易所', type: '电源电子' },
    { symbol: '2382.TW', name: '广达 (Quanta Computer)', pinyin: ['GD', 'QUANTA'], keywords: ['广达', 'AI服务器', '笔电代工'], exchange: '台湾证券交易所', type: '计算机制造' },
    { symbol: '2303.TW', name: '联电 (UMC)', pinyin: ['LD', 'UMC'], keywords: ['联电', '成熟制程'], exchange: '台湾证券交易所', type: '晶圆制造' },
    { symbol: '2603.TW', name: '长荣 (Evergreen Marine)', pinyin: ['CY', 'EVERGREEN'], keywords: ['长荣', '海运', '货柜'], exchange: '台湾证券交易所', type: '航运物流' },
    { symbol: '2881.TW', name: '富邦金 (Fubon Financial)', pinyin: ['FBJ', 'FUBON'], keywords: ['富邦金', '富邦金融'], exchange: '台湾证券交易所', type: '金控金融' },
    { symbol: '2882.TW', name: '国泰金 (Cathay Financial)', pinyin: ['GTJ', 'CATHAY'], keywords: ['国泰金', '国泰金控'], exchange: '台湾证券交易所', type: '金控金融' },
    { symbol: '0050.TW', name: '元大台湾50 (Yuanta Taiwan 50)', pinyin: ['TW50'], keywords: ['元大台湾50', '台股ETF'], exchange: '台湾证券交易所', type: '指数ETF' },
];

export function findChineseStocks(rawQuery: string): ChineseStockItem[] {
    const q = (rawQuery || '').trim().toUpperCase();
    if (!q) return [];

    // 1. Exact or partial match on 6-digit or 4-digit code
    if (/^\d{1,6}$/.test(q)) {
        return CHINESE_STOCKS.filter((item) => {
            const pureCode = item.symbol.split('.')[0].replace(/^0+/, '');
            const targetPure = q.replace(/^0+/, '');
            return pureCode.startsWith(targetPure) || item.symbol.includes(q);
        });
    }

    // 2. Ticker with suffix like 600519.SS, 0700.HK, 2330.TW
    if (q.includes('.')) {
        const matched = CHINESE_STOCKS.filter((item) => item.symbol.startsWith(q));
        if (matched.length > 0) return matched;
    }

    // 3. Pinyin abbreviation or keyword match
    return CHINESE_STOCKS.filter((item) => {
        // Pinyin prefix match
        const pinyinMatch = item.pinyin.some((p) => p.startsWith(q) || p.includes(q));
        if (pinyinMatch) return true;

        // Chinese keyword match
        const rawChinese = rawQuery.trim();
        const keywordMatch = item.keywords.some((kw) => kw.includes(rawChinese) || rawChinese.includes(kw));
        if (keywordMatch) return true;

        // English name match
        return item.name.toUpperCase().includes(q);
    });
}
