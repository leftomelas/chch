import cheerio from "cheerio"
import { Iconv } from "iconv"
import axios from "axios"
import dayjs from "dayjs"
import _ from "lodash"

const host = "http://hebi.5ch.net"
const makeThreadUrl = id => `${host}/test/read.cgi/news4vip/${id}`
const listPageUrl = `${host}/news4vip/subback.html`

const sjis2utf8 = new Iconv("SHIFT_JIS", "UTF-8//TRANSLIT//IGNORE")
// const utf82sjis = new Iconv("UTF-8//TRANSLIT//IGNORE", "SHIFT_JIS")

axios.defaults.responseType = "arraybuffer"
axios.defaults.transformResponse = [data => sjis2utf8.convert(data).toString()]

const client = axios.create({ withCredentials: true })

function titleParse(text: string): { title: string; count: number } | null {
  const m = text.match(/^\d+: ([\s\S]*?) \((\d+)\)$/)
  if (!m || !m[1]) {
    return null
  }

  return { title: m[1], count: Number(m[2]) }
}
type ThreadMin = { id: string; title: string; url: string; count: number }

export async function getThreads() {
  const res = await axios.get(listPageUrl)
  const $ = cheerio.load(res.data)
  const threads: ThreadMin[] = []
  $("#trad > a").map((i, elA) => {
    const a = $(elA)
    const res = titleParse(a.text())
    if (!res || !res.title) {
      return
    }
    const { title, count } = res
    const href = a.attr("href")
    const id = href.split("/")[0]
    const url = makeThreadUrl(id)
    threads.push({ id, title, url, count })
  })
  return { threads }
}

export type Post = {
  number: number
  name: string
  userId: string
  timestamp: number
  comma: number
  message: string
}

export type Thread = {
  title: string
  url: string
  postCount: number
  size: string
  posts: Post[]
}

const elem = (item: any): item is HTMLElement => !!item.innerText

export async function getThreadPart4Vip(url: string): Promise<Thread> {
  const $ = cheerio.load((await axios.get(url)).data)

  const title = $("h1")
    .text()
    .trim()
  const size = $("font > b").text()

  const posts: Post[] = []
  // console.log(_.zip($("dl > dt"), $("dl > dd")))
  _.zip($("dl > dt"), $("dl > dd")).map(([dt, dd], i) => {
    if (!dd || !dt) {
      return
    }
    // console.log(dd)
    const $dt = $(dt)
    const $dd = $(dd)
    const number = i + 1
    const name = $dt.find(".name").text()
    const infoText = $dt.find(".info").text()
    const m = infoText.match(/：(.*) ID:(.*)/)
    const [_m = "", dateStr = "", userId = ""] = m || []
    const timestamp = +dayjs(dateStr)
    const comma = Number(dateStr.split(".")[1])
    const message = $dd.text().trim()
    posts.push({ number, name, userId, timestamp, comma, message })
  })
  const postCount = posts.length
  return { title, url, postCount, size, posts }
}

export async function getThreadVip(url: string): Promise<Thread> {
  const $ = cheerio.load((await axios.get(url)).data)

  const title = $(".title")
    .text()
    .trim()
  const m = $(".metastats.meta.centered")
    .text()
    .match(/\d+KB/)
  const size = m ? m[0] : ""

  const posts: Post[] = []
  $(".post").map((i, elA) => {
    const div = $(elA)
    const number = Number(div.find(".number").text())
    const name = div.find(".name").text()
    const userId = div
      .find(".uid")
      .text()
      .split(":")[1]
    const dateStr = div.find(".date").text()
    const timestamp = +dayjs(dateStr)
    const comma = Number(dateStr.split(".")[1])
    const message = div
      .find(".message")
      .text()
      .trim()
    posts.push({ number, name, userId, timestamp, comma, message })
  })
  const postCount = posts.length
  return { title, url, postCount, size, posts }
}

export function getThread(url: string) {
  if (url.match(/vip2ch\.com/)) {
    return getThreadPart4Vip(url)
  } else {
    return getThreadVip(url)
  }
}

function generateForm(data: Record<string, any>): URLSearchParams {
  const params = new URLSearchParams()
  _.each(data, (value, key) => {
    params.append(key, value)
  })
  return params
}

export async function postMessage(url, message) {
  const [server] = new URL(url).hostname.split(".")

  const paths = url.split("/")
  const [_ex, thread, board] = [paths.pop(), paths.pop(), paths.pop()]
  // return
  const bbsUrl = `https://${server}.5ch.net/test/bbs.cgi` // 投稿先CGI
  const res0 = await client.get(url)
  const cookies = [
    _.get(res0.headers, ["set-cookie", 0]).split(" ")[0],
    'READJS="off"',
    "yuki=akari",
  ]
  const headers = {
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
    "accept-encoding": "gzip, deflate, br",
    "accept-language": "ja,en-US;q=0.9,en;q=0.8,es;q=0.7",
    "cache-control": "max-age=0",
    "content-type": "application/x-www-form-urlencoded",
    origin: "https://hebi.5ch.net",
    referer: url,
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.11 (KHTML, like Gecko) Chrome/23.0.1271.64 Safari/537.11",
    cookie: cookies.join("; "),
  }

  const time = Math.floor(Date.now() / 1000) - 10
  const makeForm = {
    FROM: "",
    mail: "",
    MESSAGE: message,
    bbs: board,
    key: thread,
    time,
    submit: "書き込む",
    // eslint-disable-next-line
    oekaki_thread1: "",
  }
  const form = generateForm(makeForm)

  const post = headers => client.post<string | null>(bbsUrl, form, { headers })
  const res = await post(headers)

  // console.log(res.request)
  if (res.data && res.data.indexOf("書き込み確認") !== -1) {
    cookies.push(_.get(res.headers, ["set-cookie", 0]))
    headers.cookie = cookies.join("; ")
    await post(headers)
  }
}
