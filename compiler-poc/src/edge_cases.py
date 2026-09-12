"""Edge-case ResumeJSON generators for reliability testing."""
from __future__ import annotations
from .models import ResumeJSON, Contact, Experience, Project, Skill


def edge_cases():
    yield "special-chars", ResumeJSON(
        name="A. & B. O'Neil-Smith #1 100% $ _ {x} ~ ^ ",
        headline="R&D | 50% Growth | C++ & C# | a_b {x} $var #tag",
        contact=Contact(email="weird+tag@example.test", phone="+1 555 010 0099"),
        summary="Cut costs 30% & improved uptime to 99.9%. Managed a $2M budget; #tags, under_scores, {braces}, ~tildes.",
        experience=[Experience("Engineer & Lead", "Example & Co.", "2020-Present",
                               ["Reduced spend by 40% ($400k).", "Owned C++/C# stack & CI/CD."])],
        skills=[Skill("Langs & Tools", "C++, C#, F#, 100% coverage, a_b_c, $HOME")],
    )
    yield "unicode", ResumeJSON(
        name="Jose Muller - Nino",
        headline="Senior Developpeur - Ubersetzer",
        contact=Contact(email="jose@example.test", location="Sao Paulo, Zurich"),
        summary="Cafe resume naive facade - em dash and en dash, curly quotes, ellipsis.",
        experience=[Experience("Developpeur", "Societe Generale Example", "2019-2024",
                               ["Worked in Zurich and Sao Paulo.", "Accented characters throughout."])],
        skills=[Skill("Langues", "Francais, Espanol, Deutsch")],
    )
    yield "long", ResumeJSON(
        name="Alexandria Wetherby-Montgomery III",
        headline="Principal Distinguished Staff Software Engineer and Technical Program Lead",
        contact=Contact(email="very.long.email.address.for.testing@subdomain.example.test",
                        linkedin="linkedin.example.test/in/alexandria-wetherby-montgomery-the-third-engineer"),
        summary="A very long summary that wraps across many lines to test justification. " * 6,
        experience=[Experience(
            "Principal Engineer at a Company With an Extremely Long Legal Business Name Incorporated",
            "Extraordinarily Long Organization Name International Holdings Group Limited", "January 2018 - Present",
            [f"Bullet {i+1}: " + "detailed accomplishment " * 6 for i in range(8)])],
        projects=[Project("A Project With An Unusually Long Title That Should Still Render Cleanly", "Description " * 20)],
        skills=[Skill("Everything", ", ".join(f"Skill{i}" for i in range(40)))],
    )
    yield "minimal", ResumeJSON(
        name="Min Imal", headline="Developer", contact=Contact(email="min@example.test"),
    )
    yield "long-urls", ResumeJSON(
        name="Link Tester", headline="Engineer",
        contact=Contact(email="link@example.test",
                        linkedin="linkedin.example.test/in/a-really-really-long-vanity-url-that-tests-line-breaking"),
        portfolio_line="https://portfolio.example.test/a/really/long/path/that/tests/how/urls/wrap/in/footer",
    )
