import type { Metadata } from 'next';
import LegalPage, { Section, LEGAL_EFFECTIVE_DATE, LEGAL_OPERATOR, LEGAL_CONTACT } from '@/components/LegalPage';

export const metadata: Metadata = { title: '개인정보처리방침 — AI 가계부' };

const th: React.CSSProperties = {
  textAlign: 'left', padding: '6px 10px', fontWeight: 700,
  borderBottom: '1px solid var(--card-border)', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '6px 10px', borderBottom: '1px solid var(--card-border)', verticalAlign: 'top',
};

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div style={{ overflowX: 'auto', margin: '10px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr>{head.map(h => <th key={h} style={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>{cells.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <LegalPage title="개인정보처리방침">
      <p style={{ fontSize: '0.85rem', lineHeight: 1.7 }}>
        {LEGAL_OPERATOR}(이하 &ldquo;운영자&rdquo;)은 「개인정보 보호법」 등 관련 법령을 준수하며,
        &ldquo;AI 가계부&rdquo; 서비스(이하 &ldquo;서비스&rdquo;) 이용자의 개인정보를 다음과 같이 처리합니다.
      </p>

      <Section title="1. 수집하는 개인정보의 항목 및 수집 방법">
        <p style={{ fontWeight: 700 }}>회원가입 시 (필수)</p>
        <Table
          head={['항목', '수집 목적']}
          rows={[
            ['아이디, 비밀번호', '회원 식별 및 인증 (비밀번호는 일방향 해시로 저장)'],
            ['이름', '서비스 내 표시'],
            ['이메일', '회원 식별, 중복 가입 방지, 서비스 관련 안내'],
          ]}
        />
        <p style={{ fontWeight: 700 }}>회원가입 시 (선택)</p>
        <Table
          head={['항목', '수집 목적']}
          rows={[['휴대전화번호', '계정 관리 보조 (미입력 가능, 언제든 등록·해제 가능)']]}
        />
        <p style={{ fontWeight: 700 }}>기능 이용 시 이용자가 직접 등록하는 정보 (선택)</p>
        <Table
          head={['항목', '수집 목적', '비고']}
          rows={[
            ['메일 계정 정보(IMAP 서버, 메일 주소, 앱 비밀번호)', '카드 이용내역 메일 자동수집',
             '암호화하여 저장. 카드 이용내역 관련 메일만 조회·파싱하며 그 외 메일 내용은 수집·저장하지 않음'],
            ['생년월일', '일부 카드사(우리카드) 명세서 첨부파일 복호화', '암호화하여 저장'],
            ['외부 AI 서비스 API 키', 'AI 조언 기능 호출', '암호화하여 저장'],
          ]}
        />
        <p style={{ fontWeight: 700 }}>서비스 이용 과정에서 생성·수집되는 정보</p>
        <Table
          head={['항목', '수집 목적']}
          rows={[
            ['거래 내역(일시, 금액, 사용처, 카테고리, 메모 등)', '가계부 기록·통계·예산 기능 제공'],
            ['접속 로그, 접속 IP', '서비스 안정성 확보, 부정 이용 방지'],
          ]}
        />
        <p>
          수집 방법: 회원가입 및 서비스 이용 과정에서 이용자가 직접 입력, 메일 자동수집 기능 이용 시
          이용자가 연동한 메일함에서 수집.
        </p>
      </Section>

      <Section title="2. 개인정보의 처리 목적">
        <ol>
          <li>회원 관리: 가입 의사 확인, 본인 식별·인증, 회원 자격 유지·관리</li>
          <li>서비스 제공: 가계부 기록·통계·예산·구독 관리, 카드 이용내역 자동수집, AI 조언 기능, 가구 공유 기능</li>
          <li>서비스 개선 및 안정성 확보: 장애 대응, 부정 이용 방지</li>
        </ol>
      </Section>

      <Section title="3. 개인정보의 보유 및 이용 기간">
        <ol>
          <li>회원 탈퇴 시 지체 없이 파기합니다. 다만 관계 법령에 따라 보존할 필요가 있는 경우 해당 법령에서 정한 기간 동안 보관합니다.</li>
          <li>메일 계정 정보·API 키는 이용자가 연동을 해제하면 지체 없이 파기합니다.</li>
        </ol>
      </Section>

      <Section title="4. 개인정보의 제3자 제공">
        <p>운영자는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 다음의 경우는 예외로 합니다.</p>
        <ol>
          <li>이용자가 사전에 동의한 경우</li>
          <li>법령의 규정에 의하거나, 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우</li>
        </ol>
        <p>
          <strong>AI 조언 기능 이용 시</strong>: 이용자가 API 키를 등록하고 AI 조언 기능을 실행하면, 조언 생성에
          필요한 가계부 데이터 일부가 이용자가 선택한 AI 서비스 제공사(Anthropic, OpenAI, Google 등 — 국외
          사업자)에 전송됩니다. 이는 이용자의 기능 실행에 의해 이루어지며, 전송된 데이터의 처리에는 해당
          제공사의 개인정보처리방침이 적용됩니다. AI 조언 기능을 이용하지 않으면 전송되지 않습니다.
        </p>
      </Section>

      <Section title="5. 개인정보 처리의 위탁 및 국외 이전">
        <Table
          head={['수탁자', '위탁 업무', '국가']}
          rows={[['Amazon Web Services, Inc.', '서버 호스팅 및 데이터 보관', '[배포 리전 확정 후 기재]']]}
        />
      </Section>

      <Section title="6. 개인정보의 파기 절차 및 방법">
        <ol>
          <li>파기 사유가 발생한 개인정보는 지체 없이 파기합니다.</li>
          <li>전자적 파일 형태의 정보는 복구할 수 없는 방법으로 삭제하며, DB 백업본은 백업 주기 경과 시 함께 삭제됩니다.</li>
        </ol>
      </Section>

      <Section title="7. 이용자의 권리와 행사 방법">
        <ol>
          <li>이용자는 언제든지 자신의 개인정보를 조회·수정할 수 있으며, 회원 탈퇴를 통해 수집·이용 동의를 철회할 수 있습니다.</li>
          <li>선택 항목(휴대전화번호, 메일 연동, API 키)은 서비스 내 설정에서 언제든 등록·해제할 수 있으며, 해제해도 기본 서비스 이용에는 제한이 없습니다.</li>
          <li>개인정보 열람·정정·삭제·처리정지 요구는 아래 연락처로 할 수 있으며, 운영자는 지체 없이 조치합니다.</li>
        </ol>
      </Section>

      <Section title="8. 개인정보의 안전성 확보 조치">
        <ol>
          <li>비밀번호는 일방향 해시 함수로 변환하여 저장하며, 원문을 보관하지 않습니다.</li>
          <li>메일 계정 정보, API 키, 생년월일 등 민감한 자격증명은 암호화하여 저장합니다.</li>
          <li>모든 통신 구간은 HTTPS(TLS)로 암호화합니다.</li>
          <li>접근 권한 관리: 서버 및 데이터베이스 접근은 운영자로 한정합니다.</li>
        </ol>
      </Section>

      <Section title="9. 개인정보 자동 수집 장치">
        <p>
          서비스는 로그인 상태 유지를 위한 세션 쿠키를 사용합니다. 광고·행태 분석 목적의 쿠키나 제3자 추적
          도구는 사용하지 않습니다.
        </p>
      </Section>

      <Section title="10. 만 14세 미만 아동의 개인정보">
        <p>서비스는 만 14세 미만 아동의 회원가입을 받지 않으며, 만 14세 미만 아동의 개인정보를 수집하지 않습니다.</p>
      </Section>

      <Section title="11. 개인정보 보호책임자">
        <Table
          head={['구분', '내용']}
          rows={[
            ['개인정보 보호책임자', LEGAL_OPERATOR],
            ['연락처', LEGAL_CONTACT],
          ]}
        />
        <p>
          개인정보 처리에 관한 불만은 개인정보분쟁조정위원회(www.kopico.go.kr, 1833-6972),
          개인정보침해신고센터(privacy.kisa.or.kr, 국번없이 118)에 문의할 수 있습니다.
        </p>
      </Section>

      <Section title="12. 개인정보처리방침의 변경">
        <p>
          이 방침의 내용이 추가·삭제·수정되는 경우 개정 최소 7일 전(중대한 변경은 30일 전)부터 서비스 내
          공지사항을 통해 고지합니다.
        </p>
      </Section>

      <Section title="부칙">
        <p>이 방침은 {LEGAL_EFFECTIVE_DATE}부터 시행합니다.</p>
      </Section>
    </LegalPage>
  );
}
