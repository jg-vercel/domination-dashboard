"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const OFFICIAL_STORE_URL = "https://www.dominationsworld.com/web-store";

export function DominationLinkPanel({
  bridgeUrl,
  connected,
}: {
  bridgeUrl: string;
  connected: boolean;
}) {
  const bookmarkRef = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);
  const bookmarklet = useMemo(
    () => createBookmarklet(bridgeUrl),
    [bridgeUrl],
  );

  useEffect(() => {
    bookmarkRef.current?.setAttribute("href", bookmarklet);
  }, [bookmarklet]);

  async function copyBookmarklet() {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className={`link-panel ${connected ? "is-connected" : ""}`}>
      <div className="link-panel-heading">
        <div>
          <p className="eyebrow">OFFICIAL SESSION BRIDGE</p>
          <h2>{connected ? "DomiNations 계정 연결됨" : "DomiNations 공식 로그인 연결"}</h2>
        </div>
        <span className={`card-status ${connected ? "success" : "pending"}`}>
          {connected ? "미국 서버 준비됨" : "최초 1회 설정"}
        </span>
      </div>

      <p className="link-panel-copy">
        {connected
          ? "현재 세션으로 미국 Vercel 함수에서 무료 수령을 실행합니다. 세션이 만료되면 아래 북마크로 다시 연결하세요."
          : "공식 상점 로그인은 그대로 사용하고, 로그인된 세션만 미국 Vercel 함수에 안전하게 연결합니다."}
      </p>

      <ol className="link-steps">
        <li>
          아래 <strong>Domi 연결</strong> 링크를 브라우저 북마크바로 한 번 끌어 놓습니다.
        </li>
        <li>공식 상점을 열고 평소처럼 Google 로그인을 완료합니다.</li>
        <li>공식 상점 화면에서 북마크바의 Domi 연결을 누릅니다.</li>
      </ol>

      <div className="link-actions">
        <a
          ref={bookmarkRef}
          className="bookmarklet-link"
          href="#bookmarklet"
          draggable
          onClick={(event) => event.preventDefault()}
          title="이 링크를 북마크바로 끌어 놓으세요"
        >
          Domi 연결
        </a>
        <button className="secondary-button" type="button" onClick={copyBookmarklet}>
          {copied ? "북마크 코드 복사됨" : "북마크 코드 복사"}
        </button>
        <a
          className="primary-button official-store-link"
          href={OFFICIAL_STORE_URL}
          target="_blank"
          rel="noreferrer"
        >
          공식 상점 열기 <span aria-hidden="true">↗</span>
        </a>
      </div>
      <p className="link-security-note">
        공식 로그인 정보는 브라우저 기록에서 즉시 제거되며, 대시보드 로그인·same-origin·CSRF 검증 후 서버 메모리에서 한 번만 사용됩니다.
      </p>
    </section>
  );
}

function createBookmarklet(bridgeUrl: string): string {
  const target = JSON.stringify(`${bridgeUrl}/auth/domination-bridge`);
  return `javascript:(()=>{const h=location.hostname;if(h!=="www.dominationsworld.com"&&h!=="dominationsworld.com"){alert("Open DomiNations World first.");return}const t=localStorage.getItem("dwjwt");if(!t){alert("Sign in to DomiNations World first.");return}location.href=${target}+"#token="+encodeURIComponent(t)})()`;
}
