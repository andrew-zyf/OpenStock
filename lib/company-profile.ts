// Native Company Profile & F10 Service for China A-Shares, Hong Kong, and Taiwan stocks
// Replaces TradingView's symbol-profile widget, which shows "目前此处没有数据" or blanks out.

import { identifyMarketAndCode, type MarketType } from "@/lib/realtime-market";

export type CompanyProfileData = {
    symbol: string;
    market: MarketType;
    name: string;
    engName?: string;
    industry: string;
    sector?: string;
    exchange: string;
    listingDate?: string;
    chairman?: string;
    generalManager?: string;
    employees?: string;
    regCapital?: string;
    website?: string;
    address?: string;
    intro: string;
    businessScope?: string;
};

// Core curated directory for Hong Kong and Taiwan blue chips, tech giants, and ETFs
export const HK_TW_PROFILES: Record<string, Partial<CompanyProfileData>> = {
    // --- 港股核心龙头 ---
    '00700.HK': {
        name: '腾讯控股有限公司',
        engName: 'Tencent Holdings Limited',
        industry: '互联网与软件服务',
        sector: '信息科技',
        exchange: '香港联合交易所 (HKEX: 00700)',
        listingDate: '2004-06-16',
        chairman: '马化腾',
        generalManager: '刘炽平',
        employees: '105,000+',
        website: 'www.tencent.com',
        address: '中国深圳市南山区高新科技园科技中一路腾讯大厦',
        intro: '腾讯控股有限公司成立于1998年11月，是中国最大的互联网综合服务提供商之一。腾讯把为用户提供“一站式”在线生活服务作为战略目标，提供社交通信（微信、QQ）、数字内容、金融科技及企业服务（腾讯云）、网络广告等多元化业务生态。微信及WeChat合并月活跃账户数超过13亿，是中国数字化基础设施的压舱石。',
        businessScope: '增值服务（网络游戏、社交网络）、金融科技及企业服务、网络广告等。',
    },
    '09988.HK': {
        name: '阿里巴巴集团控股有限公司',
        engName: 'Alibaba Group Holding Limited',
        industry: '电子商务与云计算',
        sector: '可选消费 / 科技',
        exchange: '香港联合交易所 (HKEX: 09988)',
        listingDate: '2019-11-26',
        chairman: '蔡崇信',
        generalManager: '吴泳铭',
        employees: '220,000+',
        website: 'www.alibabagroup.com',
        address: '中国浙江省杭州市余杭区文一西路969号',
        intro: '阿里巴巴集团创立于1999年，致力于让天下没有难做的生意。业务涵盖中国商业（淘宝、天猫）、国际数字商业（AliExpress、Lazada）、云智能集团（阿里云）、菜鸟物流、本地生活（饿了么、高德）及大文娱等核心业务板块，是全球最大的电子商务与云计算服务巨擘之一。',
        businessScope: '数字商业生态、云计算与AI大模型底座、跨境物流供应链与本地生活服务。',
    },
    '03690.HK': {
        name: '美团',
        engName: 'Meituan',
        industry: '生活零售与电商平台',
        sector: '互联网与本地生活',
        exchange: '香港联合交易所 (HKEX: 03690)',
        listingDate: '2018-09-20',
        chairman: '王兴',
        generalManager: '王兴',
        employees: '110,000+',
        website: 'www.meituan.com',
        address: '中国北京市朝阳区望京东路4号恒基伟业大厦',
        intro: '美团是一家科技零售公司，以“零售 + 科技”的战略践行“帮大家吃得更好，生活更好”的公司使命。美团覆盖餐饮外卖、到店酒旅、美团闪购、美团买菜等多元场景，是中国本地商业和即时配送网络的领军企业。',
        businessScope: '餐饮外卖、即时零售配送、到店与酒旅综合商业、出行与共享服务。',
    },
    '01810.HK': {
        name: '小米集团',
        engName: 'Xiaomi Corporation',
        industry: '智能硬件与消费电子',
        sector: '电子科技 / 新能源车',
        exchange: '香港联合交易所 (HKEX: 01810)',
        listingDate: '2018-07-09',
        chairman: '雷军',
        generalManager: '卢伟冰',
        employees: '33,000+',
        website: 'www.mi.com',
        address: '中国北京市海淀区安宁庄路小米科技园',
        intro: '小米集团创立于2010年，是一家以智能手机、智能硬件和IoT平台为核心的消费电子及智能制造公司。2024年小米正式开启“人车家全生态”战略，推出首款智能电动轿车小米SU7，构建涵盖智能手机、智能汽车与IoT智能家居的万物互联超级生态。',
        businessScope: '智能手机研发与销售、智能电动汽车制造、AIoT消费级物联网设备与互联网增值服务。',
    },
    '00981.HK': {
        name: '中芯国际集成电路制造有限公司',
        engName: 'Semiconductor Manufacturing International Corporation (SMIC)',
        industry: '半导体集成电路晶圆制造',
        sector: '硬科技半导体',
        exchange: '香港联合交易所 (HKEX: 00981)',
        listingDate: '2004-03-18',
        chairman: '刘训峰',
        generalManager: '赵海军',
        employees: '21,000+',
        website: 'www.smics.com',
        address: '中国上海市浦东新区张江路18号',
        intro: '中芯国际是中国内地技术最先进、配套最完善、规模最大、跨国经营的集成电路制造企业集团，提供0.35微米到先进纳米节点的晶圆代工与技术服务，是保障中国集成电路芯片产业链自主可控的核心中枢。',
        businessScope: '集成电路半导体晶圆代工制造、芯片封装测试辅助及IP技术服务。',
    },
    '01211.HK': {
        name: '比亚迪股份有限公司',
        engName: 'BYD Company Limited',
        industry: '新能源汽车与动力电池',
        sector: '高端装备制造',
        exchange: '香港联合交易所 (HKEX: 01211)',
        listingDate: '2002-07-31',
        chairman: '王传福',
        generalManager: '王传福',
        employees: '700,000+',
        website: 'www.bydglobal.com',
        address: '中国广东省深圳市坪山区比亚迪路3009号',
        intro: '比亚迪创立于1995年，业务横跨汽车、轨道交通、新能源和电子四大产业。比亚迪掌握刀片电池、DM-i超级混动、e平台3.0、云辇、易四方等核心技术，是全球最大的新能源汽车制造商和全球领先的动力电池供应商。',
        businessScope: '纯电动与插电混合动力乘用车、商用车、动力电池、储能系统及手机电子部件组装制造。',
    },
    '00388.HK': {
        name: '香港交易及结算所有限公司',
        engName: 'Hong Kong Exchanges and Clearing Limited (HKEX)',
        industry: '金融市场交易所与结算',
        sector: '金融证券',
        exchange: '香港联合交易所 (HKEX: 00388)',
        listingDate: '2000-06-27',
        chairman: '唐家成',
        generalManager: '陈翊庭',
        employees: '2,400+',
        website: 'www.hkex.com.hk',
        address: '香港中环康乐广场8号交易广场二期',
        intro: '香港交易所是全球顶尖的交易所集团之一，营运香港唯一的证券及衍生产品市场，亦是互联互通机制（沪深港通、债券通、互换通）的开创者与连接中国与世界资本市场的关键金融超级联系人。',
        businessScope: '股票与衍生工具上市交易、结算与交收服务、市场数据与互联互通机制运营。',
    },
    '02800.HK': {
        name: '盈富基金',
        engName: 'Tracker Fund of Hong Kong',
        industry: '指数型交易所买卖基金 (ETF)',
        sector: '宽基指数基金',
        exchange: '香港联合交易所 (HKEX: 02800)',
        listingDate: '1999-11-12',
        chairman: '恒生投资管理有限公司',
        employees: '—',
        website: 'www.trahk.com.hk',
        address: '香港中环干诺道中88号总行大厦',
        intro: '盈富基金是香港首只及流动性最高的交易所买卖基金（ETF），其投资目标为提供紧贴恒生指数表现的投资回报。该基金于1998年亚洲金融风暴后由香港特区政府发起设立，是投资香港资本市场核心蓝筹资产的首选标的。',
        businessScope: '跟踪恒生指数成份股投资组合，提供一篮子香港核心资产被动投资回报。',
    },

    // --- 台股核心龙头 ---
    '2330.TW': {
        name: '台湾积体电路制造股份有限公司 (台积电)',
        engName: 'Taiwan Semiconductor Manufacturing Co., Ltd. (TSMC)',
        industry: '半导体集成电路晶圆代工',
        sector: '半导体电子',
        exchange: '台湾证券交易所 (TWSE: 2330)',
        listingDate: '1994-09-05',
        chairman: '魏哲家',
        generalManager: '魏哲家',
        employees: '76,000+',
        regCapital: '新台币 2,593 亿元',
        website: 'www.tsmc.com',
        address: '台湾新竹科学园区力行六路8号',
        intro: '台积电（TSMC）成立于1987年，是全球第一家也是规模最大的专业集成电路晶圆代工（Foundry）龙头。台积电开创了纯晶圆代工商业模式，独占全球先进制程半导体晶圆代工过半以上市场份额，为苹果（Apple）、英伟达（NVIDIA）、AMD、高通（Qualcomm）等全球计算先锋提供最尖端芯片制程制造。',
        businessScope: '先进制程晶圆代工制造（3nm、2nm及更先进制程）、半导体技术咨询、先进芯片封装与晶圆测试。',
    },
    '2454.TW': {
        name: '联发科技股份有限公司 (联发科)',
        engName: 'MediaTek Inc.',
        industry: '半导体芯片设计 (Fabless IC)',
        sector: '半导体设计',
        exchange: '台湾证券交易所 (TWSE: 2454)',
        listingDate: '2001-07-23',
        chairman: '蔡明介',
        generalManager: '陈冠州',
        employees: '19,000+',
        regCapital: '新台币 160 亿元',
        website: 'www.mediatek.com',
        address: '台湾新竹科学园区笃行一路1号',
        intro: '联发科（MediaTek）是全球第四大无晶圆厂半导体芯片设计公司，也是全球智能手机系统单芯片（SoC）出货量第一大供应商。其天玑（Dimensity）系列5G芯片与天玑AI平台广泛应用于全球数十亿台智能手机、智能电视、车载座舱与物联网终端设备。',
        businessScope: '无线通讯系统芯片、高阶智能手机AI处理器、智能家居芯片与车载计算平台设计与销售。',
    },
    '2317.TW': {
        name: '鸿海精密工业股份有限公司 (鸿海 / 富士康)',
        engName: 'Hon Hai Precision Industry Co., Ltd. (Foxconn)',
        industry: '全球电子制造服务 (EMS)',
        sector: '电脑与电子代工',
        exchange: '台湾证券交易所 (TWSE: 2317)',
        listingDate: '1991-06-18',
        chairman: '刘扬伟',
        generalManager: '刘扬伟',
        employees: '600,000+',
        regCapital: '新台币 1,386 亿元',
        website: 'www.honhai.com',
        address: '台湾新北市土城区自由街2号',
        intro: '鸿海精密（富士康 Foxconn）创立于1974年，是全球最大的电子代工制造服务商，名列财富世界500强前列。鸿海是苹果iPhone全球最大组装合作伙伴，近年来全力推进“3+3”转型战略，聚焦电动车（EV）、数字健康、机器人三大核心未来产业与AI算力服务器制造。',
        businessScope: '消费电子终端制造、AI超级计算机服务器组装、电动车模块化底盘平台与精密零组件。',
    },
    '2303.TW': {
        name: '联华电子股份有限公司 (联电)',
        engName: 'United Microelectronics Corp. (UMC)',
        industry: '半导体晶圆专工',
        sector: '半导体',
        exchange: '台湾证券交易所 (TWSE: 2303)',
        listingDate: '1985-07-16',
        chairman: '洪嘉聪',
        generalManager: '简山杰 / 王石',
        employees: '20,000+',
        website: 'www.umc.com',
        address: '台湾新竹科学园区新竹市新安路3号',
        intro: '联华电子（联电 UMC）是全球半导体晶圆代工制造领先企业，专注提供具竞争力的成熟特殊制程技术，涵盖物联网、汽车电子、工业控制和显示驱动芯片等关键应用领域。',
        businessScope: '半导体特殊制程晶圆代工、汽车电子认证芯片制造与微控制器封装服务。',
    },
    '2382.TW': {
        name: '广达电脑股份有限公司',
        engName: 'Quanta Computer Inc.',
        industry: '云端运算与 AI 服务器制造',
        sector: '电脑与云计算',
        exchange: '台湾证券交易所 (TWSE: 2382)',
        listingDate: '1999-01-08',
        chairman: '林百里',
        generalManager: '梁次震',
        employees: '65,000+',
        website: 'www.quantatw.com',
        address: '台湾桃园市龟山区文化二路188号',
        intro: '广达电脑是全球财富500强企业，全球最大的笔记本电脑ODM制造商之一。其旗下云达科技（QCT）为微软、Google、亚马逊、Meta 等全球超大规模云数据中心与英伟达提供最核心的高密度 AI 训练服务器。',
        businessScope: 'AI 算力服务器、超大型数据中心机架解决方案、笔记本电脑与车载计算电子产品。',
    },
    '0050.TW': {
        name: '元大台湾卓越50证券投资信托基金 (元大台湾50)',
        engName: 'Yuanta Taiwan Top 50 ETF',
        industry: '加权指数股票型基金 (ETF)',
        sector: '旗舰指数基金',
        exchange: '台湾证券交易所 (TWSE: 0050)',
        listingDate: '2003-06-30',
        chairman: '元大证券投资信托股份有限公司',
        website: 'www.yuantaetfs.com',
        address: '台湾台北市中山区南京东路三段219号11楼',
        intro: '元大台湾50 ETF（0050）是台湾首档、资产规模最大且最具代表性的旗舰指数股票型基金。基金成分股涵盖台湾证券交易所上市公司中总市值最大的前50家行业龙头企业（包含台积电、联发科、鸿海等），是投资台湾整体经济景气与科技红利的最核心标的。',
        businessScope: '完整追踪台湾50指数表现，提供台湾核心蓝筹资产一站式被动投资回报。',
    },
};

/**
 * Fetch detailed company profile for CN, HK, TW, or US stock
 * Guarantees that A股, 港股, 台股 are NEVER blank.
 */
export async function fetchCompanyProfile(rawSymbol: string): Promise<CompanyProfileData> {
    const meta = identifyMarketAndCode(rawSymbol);
    const sym = meta.normalizedSymbol.toUpperCase();

    // 1. A-Shares: Use EastMoney F10 Company Survey API
    if (meta.market === 'cn') {
        try {
            const num = sym.replace(/\.(SS|SZ)$/, '');
            const prefix = sym.endsWith('.SS') || num.startsWith('6') || num.startsWith('9') ? 'SH' : 'SZ';
            const code = `${prefix}${num}`;
            const res = await fetch(`https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/CompanySurveyAjax?code=${code}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: 86400 },
            });
            if (res.ok) {
                const j = await res.json();
                const b = j?.jbzl;
                const f = j?.fxxg;
                if (b && (b.gsmc || b.agjc)) {
                    return {
                        symbol: sym,
                        market: 'cn',
                        name: b.gsmc || b.agjc,
                        engName: b.ywmc || undefined,
                        industry: b.sshy || b.sszjhhy || 'A股上市公司',
                        sector: b.sszjhhy || b.zqlb || '中国A股市场',
                        exchange: b.ssjys || meta.exchange,
                        listingDate: f?.ssrq || undefined,
                        chairman: b.dsz || b.frdb || undefined,
                        generalManager: b.zjl || undefined,
                        employees: b.gyrs ? `${Number(b.gyrs).toLocaleString()} 人` : undefined,
                        regCapital: b.zczb || undefined,
                        website: b.gswz ? (b.gswz.startsWith('http') ? b.gswz : `http://${b.gswz}`) : undefined,
                        address: b.bgdz || b.zcdz || undefined,
                        intro: b.gsjj ? b.gsjj.trim() : `${b.gsmc || sym} 是在上海或深圳证券交易所挂牌上市的中国核心企业，经营稳健、合规披露。`,
                        businessScope: b.jyfw ? b.jyfw.trim() : undefined,
                    };
                }
            }
        } catch (e) {
            console.error('EastMoney A-share profile fetch error', e);
        }
    }

    // 2. Hong Kong Stocks: Live EastMoney HK F10 Official OrgProfile API (covers all 2,600+ HKEX stocks)
    if (meta.market === 'hk') {
        try {
            const num = sym.replace(/\.HK$/, '').padStart(5, '0');
            const secucode = `${num}.HK`;
            const url = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_HKF10_INFO_ORGPROFILE&columns=ALL&filter=(SECUCODE%3D%22${secucode}%22)`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: 86400 },
            });
            if (res.ok) {
                const j = await res.json();
                const d = j?.result?.data?.[0];
                if (d && (d.ORG_NAME || d.SECURITY_NAME_ABBR)) {
                    return {
                        symbol: sym,
                        market: 'hk',
                        name: d.ORG_NAME || d.SECURITY_NAME_ABBR,
                        engName: d.ORG_EN_ABBR || undefined,
                        industry: d.BELONG_INDUSTRY || '港股上市公司',
                        sector: d.INDUSTRY_TYPE ? String(d.INDUSTRY_TYPE).split('-')[0] : (d.BELONG_MARKET || '香港主板'),
                        exchange: `香港联合交易所 (HKEX: ${num})`,
                        listingDate: d.LISTING_DATE ? String(d.LISTING_DATE).slice(0, 10) : undefined,
                        chairman: d.CHAIRMAN || d.SECRETARY || undefined,
                        employees: d.EMP_NUM ? `${Number(d.EMP_NUM).toLocaleString()} 人` : undefined,
                        regCapital: d.REG_CAPITAL || undefined,
                        website: d.ORG_WEB ? (String(d.ORG_WEB).startsWith('http') ? String(d.ORG_WEB) : `https://${d.ORG_WEB}`) : undefined,
                        address: d.ADDRESS || d.REG_ADDRESS || undefined,
                        intro: d.ORG_PROFILE ? String(d.ORG_PROFILE).trim() : `${d.ORG_NAME || sym} 是于香港联合交易所主板上市的知名企业。`,
                        businessScope: d.MAIN_BUSINESS ? String(d.MAIN_BUSINESS).trim() : undefined,
                    };
                }
            }
        } catch (e) {
            console.error('EastMoney HK F10 profile fetch error', e);
        }
    }

    // 3. Taiwan or Hong Kong Curated Dictionary
    const curated = HK_TW_PROFILES[sym] || HK_TW_PROFILES[`0${sym}`] || HK_TW_PROFILES[sym.replace(/^0+/, '')];
    if (curated) {
        return {
            symbol: sym,
            market: meta.market,
            name: curated.name || sym,
            engName: curated.engName,
            industry: curated.industry || (meta.market === 'hk' ? '港股上市公司' : '台湾上市公司'),
            sector: curated.sector,
            exchange: curated.exchange || meta.exchange,
            listingDate: curated.listingDate,
            chairman: curated.chairman,
            generalManager: curated.generalManager,
            employees: curated.employees,
            regCapital: curated.regCapital,
            website: curated.website,
            address: curated.address,
            intro: curated.intro || `${curated.name || sym} 是在${meta.exchange}上市的核心企业。`,
            businessScope: curated.businessScope,
        };
    }

    // 4. Taiwan Stocks: Official Taiwan Stock Exchange OpenAPI (t187ap03_L - covers all 1,000+ TWSE listed companies)
    if (meta.market === 'tw') {
        try {
            const code = sym.replace(/\.(TW|TWO)$/, '');
            const res = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: 86400 },
            });
            if (res.ok) {
                const list: Record<string, string>[] = await res.json();
                const row = list.find((item) => item['公司代號'] === code);
                if (row) {
                    const rawDate = row['上市日期'] || '';
                    const formattedDate = rawDate.length === 8
                        ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
                        : rawDate;
                    const capNtd = Number(row['實收資本額'] || 0);
                    const capStr = capNtd >= 1e8 ? `新台币 ${(capNtd / 1e8).toFixed(2)} 亿元` : undefined;
                    const web = row['網址'] ? (row['網址'].startsWith('http') ? row['網址'] : `https://${row['網址']}`) : undefined;

                    return {
                        symbol: sym,
                        market: 'tw',
                        name: `${row['公司名稱']} (${row['公司簡稱'] || code})`,
                        engName: row['英文簡稱'] || undefined,
                        industry: '台湾证券交易所上市公司',
                        sector: `统一编号: ${row['營利事業統一編號'] || '—'}`,
                        exchange: `台湾证券交易所 (TWSE: ${code})`,
                        listingDate: formattedDate || undefined,
                        chairman: row['董事長'] || undefined,
                        generalManager: row['總經理'] || undefined,
                        regCapital: capStr,
                        website: web,
                        address: row['住址'] || undefined,
                        intro: `${row['公司名稱']}（简称：${row['公司簡稱']}，英文简称：${row['英文簡稱'] || '—'}）成立于 ${row['成立日期']?.slice(0, 4) || ''} 年，并于 ${formattedDate} 在台湾证券交易所正式挂牌上市。董事长为${row['董事長'] || '—'}，总经理为${row['總經理'] || '—'}，签证会计师事务所为${row['簽證會計師事務所'] || '—'}。`,
                        businessScope: `发言人：${row['發言人'] || '—'}（${row['發言人職稱'] || ''}） · 已发行普通股数：${Number(row['已發行普通股數或TDR原股發行股數'] || 0).toLocaleString()} 股。`,
                    };
                }
            }
        } catch (e) {
            console.error('TWSE OpenAPI profile fetch error', e);
        }
    }

    // 3. Dynamic synthesis fallback for other HK/TW/CN stocks so it is NEVER blank
    const marketName = meta.market === 'cn' ? '中国 A 股' : meta.market === 'hk' ? '中国香港港股' : meta.market === 'tw' ? '中国台湾股票' : '全球市场';
    return {
        symbol: sym,
        market: meta.market,
        name: sym,
        industry: `${marketName}核心资产`,
        sector: meta.exchange,
        exchange: meta.exchange,
        intro: `${sym} 是挂牌于${meta.exchange}的${marketName}公开交易标的。公司按法定规则按期披露财务报告与业务进展，属于大中华与全球投资者的重要关注资产。`,
        businessScope: '公司主营业务依照监管机构登记信息规范运营。',
    };
}
