import Foundation

// MARK: - Weekday

enum Weekday: Int, CaseIterable, Codable, Identifiable, Hashable {
    case sunday = 1, monday, tuesday, wednesday, thursday, friday, saturday

    var id: Int { rawValue }

    var fullName: String { Calendar.current.weekdaySymbols[rawValue - 1] }
    var shortName: String { Calendar.current.shortWeekdaySymbols[rawValue - 1] }
    var initial: String { Calendar.current.veryShortWeekdaySymbols[rawValue - 1] }

    static func of(_ date: Date, calendar: Calendar = .current) -> Weekday {
        Weekday(rawValue: calendar.component(.weekday, from: date)) ?? .monday
    }

    /// The seven weekdays starting from the user's locale's first day of the week.
    static var localeOrdered: [Weekday] {
        let first = Calendar.current.firstWeekday
        return (0..<7).compactMap { Weekday(rawValue: ((first - 1 + $0) % 7) + 1) }
    }

    /// Monday-first order, used when laying a parsed schedule out sequentially.
    static let mondayFirst: [Weekday] = [.monday, .tuesday, .wednesday, .thursday, .friday, .saturday, .sunday]
}

// MARK: - Exercise

struct ExerciseItem: Identifiable, Codable, Hashable {
    var id: UUID
    var name: String
    var sets: Int?
    var reps: String?
    var load: String?
    var notes: String?

    init(id: UUID = UUID(),
         name: String,
         sets: Int? = nil,
         reps: String? = nil,
         load: String? = nil,
         notes: String? = nil) {
        self.id = id
        self.name = name
        self.sets = sets
        self.reps = reps
        self.load = load
        self.notes = notes
    }

    /// "4 × 8 · 135 lb · slow eccentric"
    var detail: String {
        var parts: [String] = []
        switch (sets, reps) {
        case let (s?, r?): parts.append("\(s) × \(r)")
        case let (s?, nil): parts.append(s == 1 ? "1 set" : "\(s) sets")
        case let (nil, r?): parts.append("\(r) reps")
        default: break
        }
        if let load, !load.isEmpty { parts.append(load) }
        if let notes, !notes.isEmpty { parts.append(notes) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Day

struct ScheduleDay: Identifiable, Codable, Hashable {
    var id: UUID
    var weekday: Weekday
    var title: String
    var items: [ExerciseItem]

    init(id: UUID = UUID(), weekday: Weekday, title: String, items: [ExerciseItem] = []) {
        self.id = id
        self.weekday = weekday
        self.title = title
        self.items = items
    }

    var isRestDay: Bool { items.isEmpty }
}

// MARK: - Schedule

struct GymSchedule: Identifiable, Codable, Hashable {
    var id: UUID
    var name: String
    var importedAt: Date
    var days: [ScheduleDay]

    init(id: UUID = UUID(), name: String, importedAt: Date = Date(), days: [ScheduleDay]) {
        self.id = id
        self.name = name
        self.importedAt = importedAt
        self.days = days
    }

    func day(for weekday: Weekday) -> ScheduleDay? {
        days.first { $0.weekday == weekday }
    }

    var exerciseCount: Int { days.reduce(0) { $0 + $1.items.count } }
    var trainingDayCount: Int { days.filter { !$0.isRestDay }.count }
}
